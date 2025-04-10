import { CommitteeNode } from './core/CommitteeNode';
import { ApiServer } from './network/ApiServer';
import { config } from './config';
import { logger } from './utils/logger';

async function main() {
  try {
    logger.info('启动PBFT委员会节点');
    
    // 创建Committee节点
    const node = new CommitteeNode(
      config.nodeId,
      config.port,
      config.isLeader,
      config.peers,
      config.totalNodes
    );
    
    // 启动节点
    node.start();
    logger.info(`节点 ${config.nodeId} 成功启动`);
    
    // 创建并启动API服务器
    // API端口设为比WS端口高1000
    const apiServer = new ApiServer(config.port + 1000, node);
    await apiServer.start();
    
    // 处理进程退出
    const cleanup = async () => {
      logger.info('正在关闭应用...');
      await apiServer.stop();
      node.stop();
      logger.info('应用已安全关闭');
      process.exit(0);
    };
    
    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
    
    logger.info(`PBFT委员会系统完全启动。节点ID: ${config.nodeId}, 角色: ${config.isLeader ? 'Leader' : 'Follower'}`);
    
  } catch (error) {
    logger.error('启动节点失败:', error);
    process.exit(1);
  }
}

main();