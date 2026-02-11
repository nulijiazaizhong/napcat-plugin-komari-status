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
        if (Array.isArray(payload)) {
            for (const item of payload.slice(0, 10)) {
                const name = item?.name ?? '未知节点';
                const os = item?.os ?? '-';
                const cpu = item?.cpu?.usage;
                const memUsed = item?.ram?.used;
                const memTotal = item?.ram?.total;
                let memStr = '-';
                if (memUsed && memTotal) {
                    const pct = Math.round((memUsed / memTotal) * 100);
                    memStr = `${pct}%`;
                }
                lines.push(`\n📌 ${name}`);
                lines.push(`   OS: ${os}`);
                if (typeof cpu === 'number') lines.push(`   CPU: ${Number(cpu).toFixed(2)}%`);
                lines.push(`   RAM: ${memStr}`);
            }
        } else if (payload && typeof payload === 'object') {
            const online = Array.isArray(payload.online) ? payload.online : [];
            const details = (payload.data && typeof payload.data === 'object') ? payload.data : {};
            for (const uuid of online.slice(0, 10)) {
                const item = details[uuid] || {};
                const name = item?.name ?? uuid;
                const cpu = item?.cpu?.usage;
                lines.push(`\n📌 ${name}`);
                if (typeof cpu === 'number') lines.push(`   CPU: ${Number(cpu).toFixed(2)}%`);
            }
        } else {
            lines.push('未获取到数据，请检查服务状态。');
        }
        return { text: lines.join('\n') };
    } catch (e) {
        return { error: `连接失败: ${String(e)}` };
    }
}
