/**
 * 类型定义文件
 * 定义插件内部使用的接口和类型
 *
 * 注意：OneBot 相关类型（OB11Message, OB11PostSendMsg 等）
 * 以及插件框架类型（NapCatPluginContext, PluginModule 等）
 * 均来自 napcat-types 包，无需在此重复定义。
 */

// ==================== 插件配置 ====================

/**
 * 插件主配置接口
 * 在此定义你的插件所需的所有配置项
 */
export interface PluginConfig {
    /** 全局开关：是否启用插件功能 */
    enabled: boolean;
    /** 调试模式：启用后输出详细日志 */
    debug: boolean;
    /** Komari 面板地址，如 https://status.example.com */
    komariUrl: string;
    /** API Token 或 Session Token（可选） */
    komariToken?: string;
    /** 是否以图片形式发送（NapCat 端暂以文本输出代替） */
    imageOutput: boolean;
    /** 深色主题（用于前端或图片渲染） */
    darkTheme: boolean;
    /** 视口宽度（用于图片渲染） */
    viewportWidth: number;
    /** 节点状态触发词（正则） */
    triggerNodes: string;
    /** 实时状态触发词（正则） */
    triggerRealtime: string;
    /** 公开设置触发词（正则） */
    triggerPublic: string;
    /** 版本信息触发词（正则） */
    triggerVersion: string;
    /** 按群的单独配置 */
    groupConfigs: Record<string, GroupConfig>;
}

/**
 * 群配置
 */
export interface GroupConfig {
    /** 是否启用此群的功能 */
    enabled?: boolean;
    // TODO: 在这里添加群级别的配置项
}

// ==================== API 响应 ====================

/**
 * 统一 API 响应格式
 */
export interface ApiResponse<T = unknown> {
    /** 状态码，0 表示成功，-1 表示失败 */
    code: number;
    /** 错误信息（仅错误时返回） */
    message?: string;
    /** 响应数据（仅成功时返回） */
    data?: T;
}
