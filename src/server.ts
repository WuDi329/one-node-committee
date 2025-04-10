// src/server.ts

import { PBFTSimulatorService } from './service/PBFTSimulatorService';
import { logger } from './utils/logger';

// 从环境变量获取端口，默认为3000
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;

async function main() {
  logger.info('正在启动PBFT模拟器服务...');
  const service = new PBFTSimulatorService(PORT);

  try {
    await service.start();
    logger.info(`PBFT模拟器服务已启动: http://localhost:${PORT}`);

    // 处理进程退出信号
    process.on('SIGINT', async () => {
      logger.info('收到终止信号，正在关闭服务...');
      await service.stop();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      logger.info('收到终止信号，正在关闭服务...');
      await service.stop();
      process.exit(0);
    });

    // 处理未捕获的异常
    process.on('uncaughtException', async error => {
      logger.error(`未捕获的异常: ${error}`);
      await service.stop();
      process.exit(1);
    });

    // 处理未处理的Promise拒绝
    process.on('unhandledRejection', async (reason, promise) => {
      logger.error(`未处理的Promise拒绝: ${reason}`);
      await service.stop();
      process.exit(1);
    });
  } catch (error) {
    logger.error(`启动服务失败: ${error}`);
    process.exit(1);
  }
}

// 启动服务
main().catch(error => {
  logger.error(`服务启动出错: ${error}`);
  process.exit(1);
});
