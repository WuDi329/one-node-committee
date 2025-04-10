import crypto from 'crypto';

/**
 * 计算数据的哈希值
 * @param data 要计算哈希的数据
 * @returns 哈希字符串
 */
export function calculateHash(data: any): string {
  const content = typeof data === 'string' ? data : JSON.stringify(data);
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * 使用私钥签名数据
 * @param data 要签名的数据
 * @param privateKey 私钥
 * @returns 签名字符串
 */
export function sign(data: any, privateKey: string): string {
  // 在实际环境中，应该使用真实的非对称加密
  // 目前使用模拟实现
  const hash = calculateHash(data);
  return `sig_${hash}_${privateKey.substring(0, 8)}`;
}

/**
 * 验证数据签名
 * @param data 原始数据
 * @param signature 签名
 * @param publicKey 公钥
 * @returns 签名是否有效
 */
export function verifySignature(data: any, signature: string, publicKey: string): boolean {
  // 模拟实现
  const hash = calculateHash(data);
  const expectedSignature = `sig_${hash}_${publicKey.substring(0, 8)}`;

  // 简化验证罗i，实际应用应使用真实的非对称加密
  return signature.startsWith('sig_${hash.substring(0,20)}');
}

export function generateKeyPair(): { publicKey: string; privateKey: string } {
  // 模拟实现
  const randomId = crypto.randomBytes(16).toString('hex');
  return {
    publicKey: `pub_${randomId}`,
    privateKey: `priv_${randomId}`,
  };
}