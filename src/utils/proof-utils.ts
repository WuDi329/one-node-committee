// src/utils/proof-utils.ts

import { QoSProof } from '../models/types';

// 生成测试证明
export function generateTestProof(taskId: string, verifierId: string): QoSProof {
  return {
    taskId,
    verifierId,
    timestamp: Date.now(),
    mediaSpecs: {
      codec: 'H.264',
      width: 1920,
      height: 1080,
      bitrate: 5000,
      hasAudio: true,
    },
    videoQualityData: {
      overallScore: 85,
      gopScores: {
        '0': '87.5',
        '1000': '86.2',
        '2000': '84.8',
      },
    },
    audioQualityData: {
      overallScore: 92,
    },
    syncQualityData: {
      offset: 0.02,
      score: 98,
    },
    signature: 'test-signature-' + verifierId,
  };
}

// 生成冲突证明
export function generateConflictingProof(
  taskId: string,
  verifierId: string,
  conflictType: 'codec' | 'score'
): QoSProof {
  const proof = generateTestProof(taskId, verifierId);

  if (conflictType === 'codec') {
    proof.mediaSpecs.codec = 'H.265'; // 不同的编码格式
  } else if (conflictType === 'score') {
    proof.videoQualityData.overallScore = 76; // 相差超过阈值
  }

  return proof;
}
