/**
 * 插件配置模块
 * 定义默认配置值和 WebUI 配置 Schema
 */

import type { NapCatPluginContext, PluginConfigSchema } from 'napcat-types/napcat-onebot/network/plugin/types';
import type { PluginConfig } from './types';

/** 默认配置 */
export const DEFAULT_CONFIG: PluginConfig = {
    enabled: true,
    debug: false,
    komariUrl: '',
    komariToken: '',
    imageOutput: false,
    darkTheme: true,
    viewportWidth: 600,
    triggerNodes: '查询\\s*Komari\\s*节点状态',
    triggerRealtime: '查询\\s*Komari\\s*实时状态',
    triggerPublic: '查询\\s*Komari\\s*公开设置',
    triggerVersion: '查询\\s*Komari\\s*版本信息',
    groupConfigs: {},
};

/**
 * 构建 WebUI 配置 Schema
 *
 * 使用 ctx.NapCatConfig 提供的构建器方法生成配置界面：
 *   - boolean(key, label, defaultValue?, description?, reactive?)  → 开关
 *   - text(key, label, defaultValue?, description?, reactive?)     → 文本输入
 *   - number(key, label, defaultValue?, description?, reactive?)   → 数字输入
 *   - select(key, label, options, defaultValue?, description?)     → 下拉单选
 *   - multiSelect(key, label, options, defaultValue?, description?) → 下拉多选
 *   - html(content)     → 自定义 HTML 展示（不保存值）
 *   - plainText(content) → 纯文本说明
 *   - combine(...items)  → 组合多个配置项为 Schema
 */
export function buildConfigSchema(ctx: NapCatPluginContext): PluginConfigSchema {
    return ctx.NapCatConfig.combine(
        // 插件信息头部
        ctx.NapCatConfig.html(`
            <div style="padding: 16px; background: linear-gradient(90deg,#4f46e5,#0ea5e9); border-radius: 12px; margin-bottom: 20px; color: white;">
                <h3 style="margin: 0 0 6px 0; font-size: 18px; font-weight: 600;">Komari 状态监控</h3>
                <p style="margin: 0; font-size: 13px; opacity: 0.85;">查询节点列表、实时状态、公开设置和版本信息</p>
            </div>
        `),
        ctx.NapCatConfig.boolean('enabled', '启用插件', true, '是否启用此插件的功能', true),
        ctx.NapCatConfig.boolean('debug', '调试模式', false, '启用后将输出详细的调试日志', true),
        ctx.NapCatConfig.text('komariUrl', 'Komari 服务器地址', '', '如 https://status.example.com', true),
        ctx.NapCatConfig.text('komariToken', 'API Token（可选）', '', 'API Key 或 Session Token', true),
        ctx.NapCatConfig.boolean('imageOutput', '以图片形式发送', false, 'NapCat 暂以文本输出代替', true),
        ctx.NapCatConfig.boolean('darkTheme', '深色主题', true, '用于前端/图片渲染', true),
        ctx.NapCatConfig.number('viewportWidth', '图片宽度', 600, '用于图片渲染的视口宽度', true),
        ctx.NapCatConfig.text('triggerNodes', '节点状态指令(正则)', DEFAULT_CONFIG.triggerNodes, '自定义触发指令', true),
        ctx.NapCatConfig.text('triggerRealtime', '实时状态指令(正则)', DEFAULT_CONFIG.triggerRealtime, '自定义触发指令', true),
        ctx.NapCatConfig.text('triggerPublic', '公开设置指令(正则)', DEFAULT_CONFIG.triggerPublic, '自定义触发指令', true),
        ctx.NapCatConfig.text('triggerVersion', '版本信息指令(正则)', DEFAULT_CONFIG.triggerVersion, '自定义触发指令', true)
    );
}
