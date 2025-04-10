import dotenv from 'dotenv';
import path from 'path';

// 加载.env文件
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export const config = {
  nodeId: process.env.NODE_ID || 'node_1',
  isLeader: process.env.IS_LEADER === 'true',
  port: parseInt(process.env.PORT || '3000', 10),
  peers: (process.env.PEERS || '').split(',').filter(Boolean),
  totalNodes: parseInt(process.env.TOTAL_NODES || '4', 10),
};