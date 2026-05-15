/**
 * AccountCenter 集成配置
 *
 * 所有 URL / 端口 / 域名常量集中在此，避免散落在各处。
 *
 * 注意：mailcow SMTP/IMAP 使用 IP 直连，因为 mail.ai.cuhk.edu.cn 在部分
 * 客户端环境下可能无法 DNS 解析。如果客户端网络已正确配置 DNS，也可改回域名。
 */

export const ACCOUNT_CENTER_URL = 'http://10.20.5.61:13100'
export const INTERNAL_MAIL_DOMAIN = 'ai.cuhk.edu.cn'
export const INTERNAL_MAIL_HOST = '10.20.5.61'   // mail.ai.cuhk.edu.cn — using IP for reliability
export const INTERNAL_IMAP_PORT = 993
export const INTERNAL_SMTP_PORT = 465
export const INTERNAL_MAIL_WEB_URL = 'https://10.20.5.61:9002/SOGo'
export const INTERNAL_MATRIX_HOMESERVER = 'http://10.20.5.61:18008'
export const INTERNAL_ELEMENT_WEB_URL = 'http://10.20.5.61:18080'
export const INTERNAL_CHAT_SERVER_NAME = 'aioffice.cuhksz'
export const INTERNAL_ALLOW_SELF_SIGNED_CERTS = true
