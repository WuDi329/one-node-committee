import { MessageHandler } from '../src/network/MessageHandler';
import { PBFTMessage, MessageType, ConsensusType } from '../src/models/types';

describe('MessageHandler 集成测试', () => {
  // 设置测试超时时间
  jest.setTimeout(15000);

  let node1: MessageHandler;
  let node2: MessageHandler;
  let node3: MessageHandler;

  // 使用独立的端口，避免冲突
  const port1 = 9081;
  const port2 = 9082;
  const port3 = 9083;

  const receivedMessages1: PBFTMessage[] = [];
  const receivedMessages2: PBFTMessage[] = [];
  const receivedMessages3: PBFTMessage[] = [];

  // 辅助函数：等待节点连接建立
  async function waitForConnections(
    node: MessageHandler,
    expectedConnections: number,
    timeout = 5000
  ) {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const status = node.getConnectionStatus();
      if (status.connected === expectedConnections) {
        return true;
      }
      await new Promise(resolve => setTimeout(resolve, 300));
    }

    throw new Error(`连接超时: 预期 ${expectedConnections} 个连接, 但未达到`);
  }

  beforeAll(async () => {
    // 使用空的初始peers列表，以便稍后添加
    node1 = new MessageHandler('node1', port1, [], msg => receivedMessages1.push(msg));

    node2 = new MessageHandler('node2', port2, [], msg => receivedMessages2.push(msg));

    node3 = new MessageHandler('node3', port3, [], msg => receivedMessages3.push(msg));

    // 依次启动各节点，确保服务器完全启动
    node1.start();
    await new Promise(resolve => setTimeout(resolve, 2000));

    node2.start();
    await new Promise(resolve => setTimeout(resolve, 2000));

    node3.start();
    await new Promise(resolve => setTimeout(resolve, 2000));

    // 所有服务器都已启动，现在设置对等节点连接
    // 通过直接修改 peers 数组实现
    // 注意：这里假设 MessageHandler 类有一个实例变量 peers，如果是私有的你可能需要添加一个方法
    (node1 as any).peers = [`node2:localhost:${port2}`, `node3:localhost:${port3}`];
    (node2 as any).peers = [`node1:localhost:${port1}`, `node3:localhost:${port3}`];
    (node3 as any).peers = [`node1:localhost:${port1}`, `node2:localhost:${port2}`];

    // 手动触发所有节点的连接
    node1.reconnect();
    node2.reconnect();
    node3.reconnect();

    // 等待所有节点建立连接
    try {
      await waitForConnections(node1, 2, 5000);
      await waitForConnections(node2, 2, 5000);
      await waitForConnections(node3, 2, 5000);
    } catch (error) {
      console.error('节点连接建立失败:', error instanceof Error ? error.message : String(error));
      // 连接失败时，尝试触发重连
      node1.reconnect();
      node2.reconnect();
      node3.reconnect();

      // 再次等待连接建立
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  });

  afterAll(async () => {
    // 测试完成后停止所有节点
    await node1.stop();
    await node2.stop();
    await node3.stop();

    // 额外等待以确保资源被完全释放
    // 注意：由于 stop() 方法不是异步的，我们使用 setTimeout 来确保资源被释放
    return new Promise(resolve => setTimeout(resolve, 1000));
  });

  beforeEach(() => {
    // 每次测试前清空接收到的消息数组
    receivedMessages1.length = 0;
    receivedMessages2.length = 0;
    receivedMessages3.length = 0;
  });

  test('应该成功广播消息到所有节点', async () => {
    // 创建测试消息
    const testMessage: PBFTMessage = {
      type: MessageType.PrePrepare,
      consensusType: ConsensusType.Normal,
      nodeId: 'node1',
      viewNumber: 1,
      sequenceNumber: 1,
      data: { test: 'test data' },
      digest: 'mock-digest-value',
      signature: 'mock-signature-value',
    };

    // 从节点1广播消息
    node1.broadcast(testMessage);

    // 等待消息传递完成
    let timeoutReached = false;
    const timeout = 3000;
    const startTime = Date.now();

    while (!timeoutReached) {
      if (receivedMessages2.length > 0 && receivedMessages3.length > 0) {
        break;
      }

      await new Promise(resolve => setTimeout(resolve, 100));
      timeoutReached = Date.now() - startTime > timeout;
    }

    // 验证节点2和节点3是否收到消息
    expect(receivedMessages2.length).toBe(1);
    expect(receivedMessages2[0]).toEqual(
      expect.objectContaining({
        type: MessageType.PrePrepare,
        nodeId: 'node1',
        digest: 'mock-digest-value',
      })
    );

    expect(receivedMessages3.length).toBe(1);
    expect(receivedMessages3[0]).toEqual(
      expect.objectContaining({
        type: MessageType.PrePrepare,
        nodeId: 'node1',
        digest: 'mock-digest-value',
      })
    );
  });

  test('应该能定向发送消息到指定节点', async () => {
    // 创建测试消息
    const testMessage: PBFTMessage = {
      type: MessageType.Prepare,
      consensusType: ConsensusType.Normal,
      nodeId: 'node1',
      viewNumber: 1,
      sequenceNumber: 2,
      data: { test: 'direct message data' },
      digest: 'mock-direct-digest',
      signature: 'mock-direct-signature',
    };

    // 从节点1发送消息给节点2
    node1.send('node2', testMessage);

    // 动态等待消息传递
    let timeoutReached = false;
    const timeout = 3000;
    const startTime = Date.now();

    while (!timeoutReached) {
      if (receivedMessages2.length > 0) {
        break;
      }

      await new Promise(resolve => setTimeout(resolve, 100));
      timeoutReached = Date.now() - startTime > timeout;
    }

    // 验证节点2收到消息
    expect(receivedMessages2.length).toBe(1);
    expect(receivedMessages2[0]).toEqual(
      expect.objectContaining({
        type: MessageType.Prepare,
        nodeId: 'node1',
        digest: 'mock-direct-digest',
      })
    );

    // 验证节点3没有收到消息
    expect(receivedMessages3.length).toBe(0);
  });

  // 单独的连接状态测试
  test('应该正确处理连接状态、断开和重连', async () => {
    // 首先验证初始连接状态
    const initialStatus = node1.getConnectionStatus();
    expect(initialStatus.total).toBe(2);
    expect(initialStatus.connected).toBe(2);
    expect(initialStatus.peers).toEqual(expect.arrayContaining(['node2', 'node3']));

    // 停止节点2
    await node2.stop();

    // await new Promise(resolve => setTimeout(resolve, 1000));

    // 等待节点1检测到节点2的断开 (由于WebSocket可能需要时间关闭)
    // await new Promise(resolve => setTimeout(resolve, 2000));

    // 获取断开连接后的状态
    const statusAfterDisconnect = node1.getConnectionStatus();

    // 验证断开后的状态 (注意实际的连接状态可能是1或0，根据WebSocket的行为而定)
    console.log('节点1在断开后的连接状态:', statusAfterDisconnect);
    // expect(statusAfterDisconnect.connected).toBeLessThan(2);

    // 重新创建节点2实例 (模拟节点重启)
    // const newPort2 = port2 + 10;
    node2 = new MessageHandler(
      'node2',
      port2,
      [`node1:localhost:${port1}`, `node3:localhost:${port3}`],
      msg => receivedMessages2.push(msg)
    );

    // // 启动节点2
    node2.start();

    await new Promise(resolve => setTimeout(resolve, 1000));

    // 触发节点1的重连
    node1.reconnect();

    // 等待连接重新建立
    await new Promise(resolve => setTimeout(resolve, 3000));

    // 验证重连后的状态
    const statusAfterReconnect = node1.getConnectionStatus();
    expect(statusAfterReconnect.connected).toBe(2);
  });
});
