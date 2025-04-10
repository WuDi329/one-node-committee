import WebSocket from 'ws';
import http from 'http';
import {
  PBFTMessage,
  SupplementaryAckMessage,
  SupplementaryMessage,
  SupplementaryReadyMessage,
} from '../models/types';
import { logger } from '../utils/logger';
import { config } from '../config';

export class MessageHandler {
  private isRunning: boolean = false;
  private nodeId: string;
  private peers: string[];
  private server?: WebSocket.Server;
  private connections: Map<string, WebSocket> = new Map();
  private messageCallback: (message: PBFTMessage) => void;
  private supplementaryMessageCallback?: (message: SupplementaryMessage) => void;
  private port: number;

  constructor(
    nodeId: string,
    port: number,
    peers: string[],
    messageCallback: (message: PBFTMessage) => void,
    supplementaryMessageCallback?: (message: SupplementaryMessage) => void
  ) {
    this.isRunning = true;
    this.nodeId = nodeId;
    this.port = port;
    this.peers = peers;
    this.messageCallback = messageCallback;
    this.supplementaryMessageCallback = supplementaryMessageCallback;
  }

  // 启动WebSocket服务器和客户端连接
  public start(): void {
    // 创建WebSocket服务器
    const server = http.createServer();
    this.server = new WebSocket.Server({ server });

    this.server.on('connection', (ws, req) => {
      const ip = req.socket.remoteAddress || 'unknown';
      logger.info(`新连接来自 ${ip}`);

      ws.on('message', data => {
        try {
          const message = JSON.parse(data.toString());

          // 处理不同类型的消息
          if (message.type === 'DISCONNECT') {
            logger.info(`节点 ${message.nodeId} 主动断开连接`);
            // 查找并关闭相应的连接
            for (const [id, conn] of this.connections.entries()) {
              if (id === message.nodeId) {
                this.connections.delete(id);
                ws.close();
                logger.debug(`已关闭与节点 ${id} 的连接`);
                break;
              }
            }
          } else if (message.type === 'SupplementaryReady' || message.type === 'SupplementaryAck') {
            logger.debug(`收到来自 ${message.nodeId} 的补充证明消息: ${message.type}`);
            if (this.supplementaryMessageCallback) {
              this.supplementaryMessageCallback(message as SupplementaryMessage);
            } else {
              logger.warn(`节点 ${this.nodeId} 收到补充证明消息但未设置处理回调`);
            }
          } else {
            // const message = JSON.parse(data.toString()) as PBFTMessage;
            logger.debug(`收到来自 ${message.nodeId} 的消息类型: ${message.type}`);
            this.messageCallback(message as PBFTMessage);
          }
        } catch (error) {
          logger.error('解析消息失败:', error);
        }
      });

      ws.on('close', () => {
        logger.info(`来自 ${ip} 的连接已关闭`);
        // 尝试识别断开的节点并从连接映射中移除
        for (const [id, conn] of this.connections.entries()) {
          if (conn === ws) {
            this.connections.delete(id);
            logger.info(`节点 ${id} 已断开连接`);
            break;
          }
        }
      });

      ws.on('error', error => {
        logger.error(`WebSocket 错误: ${error.message}`);
      });
    });

    // 启动服务器
    server.listen(this.port, () => {
      logger.info(`WebSocket 服务器已在端口 ${this.port} 上启动`);

      // 连接到其他节点
      setTimeout(() => this.connectToPeers(), 1000);
    });
  }

  // 连接到对等节点
  private connectToPeers(): void {
    if (!this.isRunning) {
      return;
    }
    for (const peer of this.peers) {
      try {
        const parts = peer.split(':');
        if (parts.length != 3) {
          logger.warn(`无效的对等节点格式: ${peer}`);
          continue;
        }

        const peerId = parts[0];
        const host = parts[1];
        const port = parts[2];

        const ws = new WebSocket(`ws://${host}:${port}`);

        ws.on('open', () => {
          logger.info(`${this.nodeId}已连接到对等节点 ${peerId}`);
          this.connections.set(peerId, ws);

          // 发送标识消息
          const identMsg = {
            type: 'IDENT',
            nodeId: this.nodeId,
          };
          ws.send(JSON.stringify(identMsg));
        });

        ws.on('message', data => {
          try {
            const message = JSON.parse(data.toString());
            if (message.type === 'IDENT') {
              const nodeId = message.nodeId;
              logger.info(`已识别连接的节点为 ${nodeId}`);

              // 如果已经有该节点的连接，先关闭旧连接
              const existingConn = this.connections.get(nodeId);
              if (existingConn && existingConn !== ws) {
                logger.warn(`检测到节点 ${nodeId} 的多个连接，关闭旧连接`);
                existingConn.close();
              }

              // 存储新连接
              this.connections.set(nodeId, ws);

              // 保存节点ID和WebSocket的对应关系，用于close事件中识别
              // ws.nodeId = nodeId;
            } else if (message.type === 'DISCONNECT') {
              logger.info(`对等节点 ${message.nodeId} 请求断开连接`);
              ws.close();
              this.connections.delete(message.nodeId);
            } else {
              this.messageCallback(message as PBFTMessage);
            }
          } catch (error) {
            logger.error('解析消息失败:', error);
          }
        });

        ws.on('close', () => {
          logger.info(`与对等节点 ${peerId} 的连接已关闭`);
          this.connections.delete(peerId);

          if (this.isRunning) {
            // 可以添加重连逻辑
            setTimeout(() => {
              logger.info(`尝试重新连接到 ${peerId}`);
              this.connectToPeers();
            }, 5000);
          }
        });

        ws.on('error', error => {
          logger.error(`${this.nodeId}与对等节点 ${peerId} 的WebSocket错误: ${error.message}`);
          // 错误处理时不要关闭连接，让'close'事件处理
        });
      } catch (error) {
        logger.error(`连接到对等节点失败: ${error}`);
      }
    }
  }

  // 广播消息到所有peers
  public broadcast(message: PBFTMessage): void {
    const serialized = JSON.stringify(message);
    logger.debug(`广播 ${message.type} 消息到 ${this.connections.size} 个对等节点`);

    for (const [peerId, connection] of this.connections.entries()) {
      if (connection.readyState === WebSocket.OPEN) {
        try {
          connection.send(serialized);
          logger.debug(`消息已发送到节点 ${peerId}`);
        } catch (error) {
          logger.error(`向节点 ${peerId} 发送消息失败: ${error}`);
          // 可能需要移除失败的连接
          this.connections.delete(peerId);
        }
      } else {
        logger.warn(`节点 ${peerId} 连接未打开，无法发送消息`);
        // 删除非活动连接
        this.connections.delete(peerId);
      }
    }
  }

  // 新增：广播补充证明就绪消息
  public broadcastSupplementaryReady(message: SupplementaryReadyMessage): void {
    const serialized = JSON.stringify(message);
    logger.debug(
      `广播补充证明就绪消息到 ${this.connections.size} 个对等节点，任务ID: ${message.taskId}`
    );

    for (const [peerId, connection] of this.connections.entries()) {
      if (connection.readyState === WebSocket.OPEN) {
        try {
          connection.send(serialized);
          logger.debug(`补充证明就绪消息已发送到节点 ${peerId}`);
        } catch (error) {
          logger.error(`向节点 ${peerId} 发送补充证明就绪消息失败: ${error}`);
          this.connections.delete(peerId);
        }
      } else {
        logger.warn(`节点 ${peerId} 连接未打开，无法发送补充证明就绪消息`);
        this.connections.delete(peerId);
      }
    }
  }

  // 新增：发送补充证明确认消息
  public sendSupplementaryAck(targetNodeId: string, message: SupplementaryAckMessage): void {
    const connection = this.connections.get(targetNodeId);
    if (!connection || connection.readyState !== WebSocket.OPEN) {
      logger.warn(`无法发送补充证明确认消息到节点 ${targetNodeId}: 连接不可用`);
      if (connection) this.connections.delete(targetNodeId);
      return;
    }

    try {
      const serialized = JSON.stringify(message);
      connection.send(serialized);
      logger.debug(`补充证明确认消息已发送到节点 ${targetNodeId}，任务ID: ${message.taskId}`);
    } catch (error) {
      logger.error(`向节点 ${targetNodeId} 发送补充证明确认消息失败: ${error}`);
      this.connections.delete(targetNodeId);
    }
  }

  // 发送消息到特定peer
  public send(peerId: string, message: PBFTMessage): void {
    const connection = this.connections.get(peerId);
    if (!connection || connection.readyState !== WebSocket.OPEN) {
      logger.warn(`无法发送消息到节点 ${peerId}: 连接不可用`);
      if (connection) this.connections.delete(peerId);
      return;
    }

    try {
      const serialized = JSON.stringify(message);
      connection.send(serialized);
      logger.debug(`消息已发送到节点 ${peerId}: ${message.type}`);
    } catch (error) {
      logger.error(`向节点 ${peerId} 发送消息失败: ${error}`);
      this.connections.delete(peerId);
    }
  }

  public async stop(): Promise<void> {
    logger.info(`节点 ${this.nodeId} 开始关闭...`);

    this.isRunning = false;

    // 1. 获取并保存HTTP服务器引用
    if (!this.server) {
      return;
    }

    const httpServer = this.server.options.server as http.Server;

    // 2. 首先关闭所有客户端连接
    for (const [peerId, connection] of this.connections.entries()) {
      try {
        if (connection.readyState === WebSocket.OPEN) {
          const disconnectMsg = { type: 'DISCONNECT', nodeId: this.nodeId };
          connection.send(JSON.stringify(disconnectMsg));
          logger.debug(`已发送断开消息到节点 ${peerId}`);
        }
        connection.close();
        logger.debug(`已关闭与节点 ${peerId} 的连接`);
      } catch (error) {
        logger.error(`关闭与节点 ${peerId} 的连接时出错: ${error}`);
      }
    }

    // 清空连接映射
    this.connections.clear();

    // 3. 终止所有现有连接
    this.server.clients.forEach(client => {
      try {
        client.terminate(); // 强制关闭连接
      } catch (err) {
        logger.error(`强制关闭连接失败: ${err}`);
      }
    });

    // 4. 关闭服务器
    return new Promise<void>(resolve => {
      // 设置超时
      const timeout = setTimeout(() => {
        logger.warn(`节点 ${this.nodeId} 服务器关闭超时，强制退出`);

        // 尝试检查服务器状态
        if (httpServer) {
          logger.debug(`HTTP服务器状态: ${httpServer.listening ? '监听中' : '已关闭'}`);
        }

        // 确保清理资源
        this.server = undefined;
        resolve();
      }, 3000);

      try {
        // 先关闭WebSocket服务器
        this.server!.close(wsErr => {
          if (wsErr) {
            logger.error(`关闭WebSocket服务器失败: ${wsErr}`);
          } else {
            logger.info(`节点 ${this.nodeId} WebSocket服务器已关闭`);
          }

          // 再关闭HTTP服务器
          if (httpServer && httpServer.listening) {
            // 尝试关闭所有连接后再关闭服务器
            httpServer.close(httpErr => {
              if (httpErr) {
                logger.error(`关闭HTTP服务器失败: ${httpErr}`);
              } else {
                logger.info(`节点 ${this.nodeId} HTTP服务器已关闭`);
              }

              clearTimeout(timeout);
              this.server = undefined;
              resolve();
            });
          } else {
            clearTimeout(timeout);
            this.server = undefined;
            resolve();
          }
        });
      } catch (error) {
        logger.error(`关闭服务器时出错: ${error}`);
        clearTimeout(timeout);
        this.server = undefined;
        resolve();
      }
    });
  }
  // 获取连接状态
  public getConnectionStatus(): { total: number; connected: number; peers: string[] } {
    const connectedPeers = Array.from(this.connections.keys());
    return {
      total: this.peers.length,
      connected: this.connections.size,
      peers: connectedPeers,
    };
  }

  // 重新连接到所有对等节点
  public reconnect(): void {
    logger.info('尝试重新连接到所有对等节点...');
    this.connectToPeers();
  }
}
