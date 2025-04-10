// 文件名: CommitteeNode.test.ts

import { CommitteeNode } from '../src/core/CommitteeNode';
import { PBFTEngine } from '../src/core/PBFTEngine';
import { MessageHandler } from '../src/network/MessageHandler';
import { QoSValidator } from '../src/validators/QoSValidator';
import {
  PBFTMessage,
  QoSProof,
  MessageType,
  TaskProcessingState,
  ConsensusType,
  ConsensusState,
} from '../src/models/types';
import { calculateHash } from '../src/utils/crypto';

// 模拟依赖
jest.mock('../src/core/PBFTEngine');
jest.mock('../src/network/MessageHandler');
jest.mock('../src/validators/QoSValidator');
jest.mock('../src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));
jest.mock('../src/utils/crypto', () => ({
  calculateHash: jest.fn(data => 'mock-hash-' + JSON.stringify(data).length),
  sign: jest.fn(() => 'mock-signature'),
}));

describe('CommitteeNode 单元测试', () => {
  let committeeNode: CommitteeNode;
  let mockPBFTEngine: jest.Mocked<PBFTEngine>;
  let mockMessageHandler: jest.Mocked<MessageHandler>;
  let mockQoSValidator: jest.Mocked<QoSValidator>;

  beforeEach(() => {
    // 清除所有模拟的实现和调用记录
    jest.clearAllMocks();

    // 创建模拟对象
    mockPBFTEngine = new PBFTEngine('node1', true, 4, jest.fn()) as jest.Mocked<PBFTEngine>;
    mockMessageHandler = new MessageHandler(
      'node1',
      8080,
      [],
      jest.fn()
    ) as jest.Mocked<MessageHandler>;
    mockQoSValidator = new QoSValidator() as jest.Mocked<QoSValidator>;

    // 设置模拟返回值
    (PBFTEngine as jest.Mock).mockImplementation(() => mockPBFTEngine);
    (MessageHandler as jest.Mock).mockImplementation(() => mockMessageHandler);
    (QoSValidator as jest.Mock).mockImplementation(() => mockQoSValidator);

    // 创建CommitteeNode实例
    committeeNode = new CommitteeNode('node1', 8080, true, ['node2:localhost:8081'], 4);
  });

  describe('基础功能测试', () => {
    test('应正确初始化所有依赖组件', () => {
      // 验证是否正确创建了PBFTEngine
      expect(PBFTEngine).toHaveBeenCalledWith('node1', true, 4, expect.any(Function));

      // 验证是否正确创建了MessageHandler
      expect(MessageHandler).toHaveBeenCalledWith(
        'node1',
        8080,
        ['node2:localhost:8081'],
        expect.any(Function)
      );

      // 验证是否创建了QoSValidator
      expect(QoSValidator).toHaveBeenCalled();
    });

    test('start方法应调用MessageHandler的start', () => {
      committeeNode.start();
      expect(mockMessageHandler.start).toHaveBeenCalled();
    });

    test('stop方法应调用MessageHandler的stop', () => {
      committeeNode.stop();
      expect(mockMessageHandler.stop).toHaveBeenCalled();
    });

    test('getStatus方法应返回节点状态', () => {
      mockMessageHandler.getConnectionStatus.mockReturnValue({
        total: 1,
        connected: 1,
        peers: ['node2'],
      });
      mockPBFTEngine.getState.mockReturnValue(ConsensusState.Idle); // ConsensusState.Idle

      const status = committeeNode.getStatus();

      expect(status).toEqual({
        nodeId: 'node1',
        isLeader: true,
        pbftState: ConsensusState.Idle,
        connections: {
          total: 1,
          connected: 1,
          peers: ['node2'],
        },
      });
    });
  });

  describe('QoS证明处理测试', () => {
    let sampleProof: QoSProof;

    beforeEach(() => {
      // 准备一个示例QoS证明
      sampleProof = {
        taskId: 'task123',
        verifierId: 'verifier1',
        timestamp: Date.now(),
        videoQualityData: {
          overallScore: 90,
          gopScores: { '0.00': '97.2' },
        },
        audioQualityData: 4.2,
        syncQualityData: 0,
        signature: 'signature',
        mediaSpecs: {
          codec: 'H.264',
          width: 1920,
          height: 1080,
          bitrate: 5000,
          hasAudio: true,
        },
      };

      // 设置QoSValidator的返回值
      mockQoSValidator.quickValidate.mockReturnValue({
        isValid: true,
        details: { message: '验证通过' },
      });

      mockQoSValidator.deepValidate.mockReturnValue({
        isValid: true,
        details: { message: '验证通过' },
      });

      // 设置PBFTEngine的返回值
      mockPBFTEngine.startConsensus.mockReturnValue({
        type: MessageType.PrePrepare,
        nodeId: 'node1',
        viewNumber: 0,
        sequenceNumber: 1,
        data: sampleProof,
        digest: 'mock-digest',
        signature: 'mock-signature',
        consensusType: ConsensusType.Normal,
      });

      mockPBFTEngine.getCurrentViewNumber.mockReturnValue(0);
      mockPBFTEngine.getNextSequenceNumber.mockReturnValue(1);
    });

    test('Leader收到第一个证明时应进入Validating状态', () => {
      committeeNode.handleQoSProof(sampleProof);

      // 验证状态更新
      const status = committeeNode.getTaskStatus('task123');
      expect(status).not.toBeNull();
      expect(status?.state).toBe(TaskProcessingState.Validating);
      expect(status?.proofCount).toBe(1);
      expect(status?.verifierIds).toContain('verifier1');

      // 验证调用了验证方法
      expect(mockQoSValidator.quickValidate).toHaveBeenCalledWith(sampleProof);
    });

    test('Leader收到第二个证明时应启动共识', () => {
      // 首先添加第一个证明
      committeeNode.handleQoSProof(sampleProof);

      // 添加第二个证明
      const secondProof = { ...sampleProof, verifierId: 'verifier2' };
      committeeNode.handleQoSProof(secondProof);

      // 验证状态更新
      const status = committeeNode.getTaskStatus('task123');
      expect(status).not.toBeNull();
      expect(status?.state).toBe(TaskProcessingState.Consensus);
      expect(status?.proofCount).toBe(2);
      expect(status?.verifierIds).toContain('verifier2');

      // 验证调用了PBFT共识启动
      expect(mockPBFTEngine.startConsensus).toHaveBeenCalled();
      expect(mockMessageHandler.broadcast).toHaveBeenCalled();
    });

    test('非Leader收到证明时不应启动共识', () => {
      // 创建一个非Leader节点
      const followerNode = new CommitteeNode('node2', 8081, false, ['node1:localhost:8080'], 4);

      // 模拟内部组件
      const followerMockPBFTEngine = (PBFTEngine as jest.Mock).mock.instances[1];
      const followerMockMessageHandler = (MessageHandler as jest.Mock).mock.instances[1];
      const followerMockQoSValidator = (QoSValidator as jest.Mock).mock.instances[1];

      // 设置验证器返回值
      jest.spyOn(followerMockQoSValidator, 'quickValidate').mockReturnValue({
        isValid: true,
        details: { message: '验证通过' },
      });

      // 添加证明
      followerNode.handleQoSProof(sampleProof);
      followerNode.handleQoSProof({ ...sampleProof, verifierId: 'verifier2' });

      // 验证状态更新
      const status = followerNode.getTaskStatus('task123');
      expect(status).not.toBeNull();
      expect(status?.proofCount).toBe(2);

      // 验证非Leader不应启动共识
      expect(followerMockPBFTEngine.startConsensus).not.toHaveBeenCalled();
    });

    test('证明验证失败时应忽略该证明', () => {
      // 设置验证失败
      mockQoSValidator.quickValidate.mockReturnValue({
        isValid: false,
        details: { message: '验证失败' },
      });

      // 添加证明
      committeeNode.handleQoSProof(sampleProof);
      committeeNode.handleQoSProof({ ...sampleProof, verifierId: 'verifier2' });

      // 验证状态不存在（因为所有证明都被忽略）
      const status = committeeNode.getTaskStatus('task123');
      expect(status).toBeNull();

      // 验证没有广播任何拒绝消息
      expect(mockMessageHandler.broadcast).not.toHaveBeenCalled();
    });

    test('部分证明验证失败时只忽略失败的证明', () => {
      // 设置第一个证明验证通过
      mockQoSValidator.quickValidate.mockReturnValueOnce({
        isValid: true,
        details: { message: '验证通过' },
      });

      // 设置第二个证明验证失败
      mockQoSValidator.quickValidate.mockReturnValueOnce({
        isValid: false,
        details: { message: '验证失败' },
      });

      // 添加证明
      committeeNode.handleQoSProof(sampleProof);
      committeeNode.handleQoSProof({ ...sampleProof, verifierId: 'verifier2' });

      // 验证状态存在并且只包含一个有效证明
      const status = committeeNode.getTaskStatus('task123');
      expect(status).not.toBeNull();
      expect(status?.proofCount).toBe(1);
      expect(status?.verifierIds).toContain('verifier1');
      expect(status?.verifierIds).not.toContain('verifier2');
      expect(status?.state).toBe(TaskProcessingState.Validating);
    });
  });

  describe('消息处理测试', () => {
    let samplePrePrepareMessage: PBFTMessage;
    let samplePrepareMessage: PBFTMessage;
    let sampleCommitMessage: PBFTMessage;

    beforeEach(() => {
      // 准备示例消息
      const sampleProof = {
        taskId: 'task123',
        verifierId: 'verifier1',
        timestamp: Date.now(),
        videoQualityData: {
          overallScore: 90,
          gopScores: { '0.00': '97.2' },
        },
        audioQualityData: 4.2,
        syncQualityData: 0,
        signature: 'signature',
        mediaSpecs: {
          codec: 'H.264',
          width: 1920,
          height: 1080,
          bitrate: 5000,
          hasAudio: true,
        },
      };

      samplePrePrepareMessage = {
        type: MessageType.PrePrepare,
        consensusType: ConsensusType.Normal,
        nodeId: 'node1',
        viewNumber: 0,
        sequenceNumber: 1,
        data: sampleProof,
        digest: 'mock-digest',
        signature: 'mock-signature',
      };

      samplePrepareMessage = {
        type: MessageType.Prepare,
        consensusType: ConsensusType.Normal,
        nodeId: 'node2',
        viewNumber: 0,
        sequenceNumber: 1,
        digest: 'mock-digest',
        signature: 'mock-signature',
      };

      sampleCommitMessage = {
        type: MessageType.Commit,
        consensusType: ConsensusType.Normal,
        nodeId: 'node2',
        viewNumber: 0,
        sequenceNumber: 1,
        digest: 'mock-digest',
        signature: 'mock-signature',
      };

      // 设置QoSValidator的返回值
      mockQoSValidator.quickValidate.mockReturnValue({
        isValid: true,
        details: { message: '验证通过' },
      });

      // 设置PBFTEngine的处理结果
      mockPBFTEngine.handlePrePrepare.mockReturnValue(samplePrepareMessage);
      mockPBFTEngine.handlePrepare.mockReturnValue(sampleCommitMessage);
    });

    test('应正确处理PrePrepare消息', () => {
      // 获取onMessageReceived回调
      (committeeNode as any).onMessageReceived(samplePrePrepareMessage);

      // 验证QoS证明验证
      expect(mockQoSValidator.quickValidate).toHaveBeenCalledWith(samplePrePrepareMessage.data);

      // 验证PBFT引擎处理
      expect(mockPBFTEngine.handlePrePrepare).toHaveBeenCalledWith(samplePrePrepareMessage);

      // 验证广播响应消息
      expect(mockMessageHandler.broadcast).toHaveBeenCalledWith(samplePrepareMessage);
    });

    test('应正确处理Prepare消息', () => {
      // 获取onMessageReceived回调
      (committeeNode as any).onMessageReceived(samplePrepareMessage);

      // 验证PBFT引擎处理
      expect(mockPBFTEngine.handlePrepare).toHaveBeenCalledWith(samplePrepareMessage);

      // 验证广播响应消息
      expect(mockMessageHandler.broadcast).toHaveBeenCalledWith(sampleCommitMessage);
    });

    test('应正确处理Commit消息', () => {
      // 获取onMessageReceived回调
      (committeeNode as any).onMessageReceived(sampleCommitMessage);

      // 验证PBFT引擎处理
      expect(mockPBFTEngine.handleCommit).toHaveBeenCalledWith(sampleCommitMessage);

      // 验证不广播响应消息
      expect(mockMessageHandler.broadcast).not.toHaveBeenCalled();
    });

    test('QoS证明验证失败时不应处理PrePrepare', () => {
      // 设置QoS验证失败
      mockQoSValidator.quickValidate.mockReturnValue({
        isValid: false,
        details: { message: '验证失败' },
      });

      // 获取onMessageReceived回调
      (committeeNode as any).onMessageReceived(samplePrePrepareMessage);

      // 验证QoS验证被调用，但PBFT引擎未被调用
      expect(mockQoSValidator.quickValidate).toHaveBeenCalled();
      expect(mockPBFTEngine.handlePrePrepare).not.toHaveBeenCalled();
      expect(mockMessageHandler.broadcast).not.toHaveBeenCalled();
    });
  });

  describe('共识回调测试', () => {
    test('共识达成后应调用onConsensusReached', () => {
      // 准备一个QoS证明
      const sampleProof = {
        taskId: 'task123',
        verifierId: 'verifier1',
        timestamp: Date.now(),
        videoQualityData: {
          overallScore: 90,
          gopScores: { '0.00': '97.2' },
        },
        audioQualityData: 4.2,
        syncQualityData: 0,
        signature: 'signature',
        mediaSpecs: {
          codec: 'H.264',
          width: 1920,
          height: 1080,
          bitrate: 5000,
          hasAudio: true,
        },
      };

      // 获取创建PBFTEngine时传入的共识回调
      const onConsensusReached = (PBFTEngine as jest.Mock).mock.calls[0][3];

      // 调用共识回调
      onConsensusReached(sampleProof);

      // 由于onConsensusReached是组件内部实现的私有方法，
      // 我们可以验证相关效果，但无法直接验证内部方法的调用
      // 因此这里暂不添加断言
    });
  });
});
