import { pluginState } from '../core/state';
import type { NapCatPluginContext } from 'napcat-types/napcat-onebot/network/plugin/types';
import WebSocket from 'ws';

interface ApiSuccess<T = unknown> {
    status: 'success';
    data: T;
    message?: string;
}
interface ApiFailed {
    status: 'failed' | string;
    message?: string;
}

type ApiResp<T> = ApiSuccess<T> | ApiFailed | Record<string, unknown>;

export interface KomariNode {
    id?: string;
    uuid?: string;
    name?: string;
    region?: string;
    os?: string;
    cpu_name?: string;
    cpu_cores?: number;
    mem_total?: number;
    disk_total?: number;
    updated_at?: string;
    updated_at_cn?: string;
    is_online?: boolean;
    price?: number;
    currency?: string;
    billing_cycle?: number;
    traffic_limit?: number;
    traffic_limit_type?: string;
    // 实时字段
    cpu_usage_percent?: number;
    ram_total_gb?: number;
    ram_used_gb?: number;
    ram_usage_percent?: number;
    disk_total_gb?: number;
    disk_used_gb?: number;
    disk_usage_percent?: number;
    net_up_str?: string;
    net_down_str?: string;
    traffic_up_str?: string;
    traffic_down_str?: string;
    uptime_str?: string;
    load_1?: number;
    load_5?: number;
    load_15?: number;
    virtualization?: string;
    group?: string;
    created_at?: string;
}

function buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};
    const token = pluginState.config.komariToken?.trim();
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
        headers['Cookie'] = `session_token=${token}`;
    }
    return headers;
}

function getBaseUrl(): string {
    return (pluginState.config.komariUrl || '').replace(/\/+$/, '');
}

export async function fetchApi<T = unknown>(endpoint: string): Promise<{ data?: T; error?: string; raw?: ApiResp<T> }> {
    const base = getBaseUrl();
    if (!base) return { error: '请在配置中设置 Komari 服务器地址' };
    const url = `${base}${endpoint}`;
    try {
        const resp = await fetch(url, { headers: buildHeaders() as any, method: 'GET' });
        if (!resp.ok) return { error: `API 请求错误: ${resp.status}` };
        const json = (await resp.json()) as ApiResp<T>;
        return { raw: json, data: (json as any).data ?? json as any };
    } catch (e) {
        return { error: String(e) };
    }
}

export async function getVersionInfo(): Promise<string> {
    const { raw, error } = await fetchApi<{ version?: string; hash?: string }>('/api/version');
    if (error) return error;
    const data = (raw as ApiSuccess<{ version?: string; hash?: string }>)?.data || {};
    return `Komari 版本: ${data.version ?? '-'} (${data.hash ?? '-'})`;
}

export async function getPublicSettings(): Promise<string> {
    const { raw, error } = await fetchApi<Record<string, unknown>>('/api/public');
    if (error) return error;
    const settings = (raw as ApiSuccess<Record<string, unknown>>)?.data || {};
    const sitename = String(settings['sitename'] ?? '未知');
    const description = String(settings['description'] ?? '');
    const theme = String(settings['theme'] ?? '默认');
    return ['站点名称: ' + sitename, '描述: ' + description, '主题: ' + theme].join('\n');
}

export async function getNodesStatus(): Promise<{ text: string } | { error: string }> {
    const { raw, error } = await fetchApi<KomariNode[]>('/api/nodes');
    if (error) return { error };
    if (!raw || (raw as any).status !== 'success') {
        return { error: `API 调用失败: ${(raw as any)?.message ?? '未知错误'}` };
    }
    const nodes = ((raw as ApiSuccess<KomariNode[]>).data) || [];
    if (!nodes.length) return { error: '未找到任何节点。' };

    const nowUtc = Date.now();
    const tzOffsetMs = 8 * 3600 * 1000;

    const processed = nodes.map((node) => {
        let isOnline = false;
        const updated = node.updated_at;
        if (updated) {
            try {
                const iso = updated.endsWith('Z') ? updated.replace('Z', '+00:00') : updated;
                const t = Date.parse(iso);
                if (Number.isFinite(t)) {
                    const diffSec = (nowUtc - t) / 1000;
                    if (diffSec < 600) isOnline = true;
                    const cn = new Date(t + tzOffsetMs);
                    node.updated_at_cn = `${cn.getUTCFullYear()}-${String(cn.getUTCMonth() + 1).padStart(2, '0')}-${String(cn.getUTCDate()).padStart(2, '0')} ${String(cn.getUTCHours()).padStart(2, '0')}:${String(cn.getUTCMinutes()).padStart(2, '0')}:${String(cn.getUTCSeconds()).padStart(2, '0')}`;
                }
            } catch {}
        }
        node.is_online = isOnline;
        return node;
    });

    const lines: string[] = ['🖥️ Komari 服务器状态'];
    for (const n of processed) {
        const name = n.name ?? '未知';
        const os = n.os ?? '未知';
        const cpuName = n.cpu_name ?? '未知';
        const cores = n.cpu_cores ?? 0;
        const region = n.region ?? '';
        const memGb = (n.mem_total ?? 0) / 1024 / 1024 / 1024;
        const diskGb = (n.disk_total ?? 0) / 1024 / 1024 / 1024;
        const statusIcon = n.is_online ? '🟢' : '🔴';
        lines.push('');
        lines.push(`📌 ${statusIcon} ${region} ${name}`);
        lines.push(`   系统: ${os}`);
        lines.push(`   CPU: ${cpuName} (${cores} C)`);
        lines.push(`   内存: ${memGb.toFixed(2)} GB`);
        lines.push(`   磁盘: ${diskGb.toFixed(2)} GB`);
        const updated = n.updated_at_cn || (n.updated_at ? n.updated_at.replace('T', ' ').replace('Z', '') : '');
        if (updated) lines.push(`   更新: ${updated}`);
    }
    return { text: lines.join('\n') };
}

export async function getRealtimeStatus(): Promise<{ text: string } | { error: string }> {
    const base = getBaseUrl();
    if (!base) return { error: '请在配置中设置 Komari 服务器地址' };
    const wsUrl = base.replace('https://', 'wss://').replace('http://', 'ws://') + '/api/clients';

    // 1. 拉取静态节点信息用于补全
    const staticNodes: Record<string, any> = {};
    try {
        const { raw: nodesRaw } = await fetchApi('/api/nodes');
        if ((nodesRaw as ApiSuccess<any[]>)?.data) {
            for (const n of (nodesRaw as ApiSuccess<any[]>).data) {
                if (n.id) staticNodes[n.id] = n;
                if (n.uuid) staticNodes[n.uuid] = n;
            }
        }
    } catch {}

    try {
        const ws = new WebSocket(wsUrl, { headers: buildHeaders() });
        const data = await new Promise<any>((resolve, reject) => {
            let resolved = false;
            ws.on('open', () => ws.send('get'));
            ws.on('message', (msg) => {
                if (resolved) return;
                resolved = true;
                try {
                    resolve(JSON.parse(String(msg)));
                } catch (e) {
                    resolve({});
                } finally {
                    ws.close();
                }
            });
            ws.on('error', (err) => {
                if (!resolved) {
                    resolved = true;
                    reject(err);
                }
            });
            setTimeout(() => {
                if (!resolved) {
                    resolved = true;
                    reject(new Error('实时数据超时'));
                }
                ws.close();
            }, 3000);
        });

        const payload = data?.data ?? data;
        const lines: string[] = ['📊 Komari 实时状态'];

        // 统一整理为节点列表
        let nodes: KomariNode[] = [];
        if (Array.isArray(payload)) {
            nodes = payload.slice(0, 10);
        } else if (payload && typeof payload === 'object') {
            const online = Array.isArray(payload.online) ? payload.online : [];
            const details = (payload.data && typeof payload.data === 'object') ? payload.data : {};
            for (const uuid of online.slice(0, 10)) {
                nodes.push(details[uuid] || { uuid });
            }
        }

        // 逐节点处理：补全静态信息 + 格式化实时字段
        for (let node of nodes) {
            if (typeof node === 'string') {
                try { node = JSON.parse(node); } catch {}
            }
            if (!node || typeof node !== 'object') continue;

            // 补全静态信息
            const lookup = node.uuid || node.id;
            if (lookup && staticNodes[lookup]) {
                const static = staticNodes[lookup];
                for (const k of ['name', 'region', 'os', 'cpu_name', 'cpu_cores', 'mem_total', 'disk_total']) {
                    if (!node[k] && static[k]) node[k] = static[k];
                }
            }

            // 格式化实时字段
            // CPU
            if (node.cpu && typeof node.cpu === 'object') {
                const usage = node.cpu.usage;
                if (typeof usage === 'number') node.cpu_usage_percent = Number(usage);
            }
            // RAM
            if (node.ram && typeof node.ram === 'object') {
                const used = node.ram.used;
                const total = node.ram.total;
                if (typeof used === 'number' && typeof total === 'number' && total > 0) {
                    node.ram_total_gb = total / 1024 ** 3;
                    node.ram_used_gb = used / 1024 ** 3;
                    node.ram_usage_percent = (used / total) * 100;
                }
            } else if (typeof node.mem_total === 'number') {
                node.ram_total_gb = node.mem_total / 1024 ** 3;
            }
            // Disk
            if (node.disk && typeof node.disk === 'object') {
                const used = node.disk.used;
                const total = node.disk.total;
                if (typeof used === 'number' && typeof total === 'number' && total > 0) {
                    node.disk_total_gb = total / 1024 ** 3;
                    node.disk_used_gb = used / 1024 ** 3;
                    node.disk_usage_percent = (used / total) * 100;
                }
            } else if (typeof node.disk_total === 'number') {
                node.disk_total_gb = node.disk_total / 1024 ** 3;
            }
            // Network
            if (node.network && typeof node.network === 'object') {
                const up = node.network.up;
                const down = node.network.down;
                const totalUp = node.network.totalUp;
                const totalDown = node.network.totalDown;
                const fmtSpeed = (b: number) => {
                    if (b > 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB/s`;
                    return `${(b / 1024).toFixed(1)} KB/s`;
                };
                const fmtTraffic = (b: number) => {
                    if (b > 1024 ** 3) return `${(b / 1024 ** 3).toFixed(2)} GB`;
                    return `${(b / 1024 ** 2).toFixed(2)} MB`;
                };
                if (typeof up === 'number') node.net_up_str = fmtSpeed(up);
                if (typeof down === 'number') node.net_down_str = fmtSpeed(down);
                if (typeof totalUp === 'number') node.traffic_up_str = fmtTraffic(totalUp);
                if (typeof totalDown === 'number') node.traffic_down_str = fmtTraffic(totalDown);
            }
            // Uptime
            if (typeof node.uptime === 'number') {
                const sec = node.uptime;
                const d = Math.floor(sec / 86400);
                const h = Math.floor((sec % 86400) / 3600);
                node.uptime_str = `${d}天 ${h}小时`;
            }
            // Load
            if (node.load && typeof node.load === 'object') {
                node.load_1 = node.load.load1;
                node.load_5 = node.load.load5;
                node.load_15 = node.load.load15;
            }

            // 文本输出
            lines.push('');
            lines.push(`📌 ${node.region ?? ''} ${node.name ?? '未知节点'}`);
            lines.push(`   OS: ${node.os ?? '-'}`);
            if (typeof node.cpu_usage_percent === 'number') lines.push(`   CPU: ${node.cpu_usage_percent.toFixed(2)}%`);
            if (typeof node.ram_total_gb === 'number') lines.push(`   内存: ${node.ram_total_gb.toFixed(2)} GB`);
            if (typeof node.disk_total_gb === 'number') lines.push(`   磁盘: ${node.disk_total_gb.toFixed(2)} GB`);
            if (node.net_up_str || node.net_down_str) {
                lines.push(`   网络: ↑${node.net_up_str ?? '-'} ↓${node.net_down_str ?? '-'}`);
            }
            if (node.uptime_str) lines.push(`   运行: ${node.uptime_str}`);
            if (typeof node.load_1 === 'number') {
                lines.push(`   负载: ${node.load_1.toFixed(2)} / ${(node.load_5 ?? 0).toFixed(2)} / ${(node.load_15 ?? 0).toFixed(2)}`);
            }
        }

        if (!lines.length || lines.length === 1) {
            lines.push('未获取到数据，请检查服务状态。');
        }
        return { text: lines.join('\n') };
    } catch (e) {
        return { error: `连接失败: ${String(e)}` };
    }
}
