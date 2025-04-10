import { MetricsCollector } from './MetricsCollector';
import { EventData } from '../models/types';

// 全局单例
export class GlobalMetricsCollector {
  private static instance: MetricsCollector;

  // 禁止直接实例化
  private constructor() {}

  // 获取单例实例
  public static getInstance(): MetricsCollector {
    if (!GlobalMetricsCollector.instance) {
      GlobalMetricsCollector.instance = new MetricsCollector(true);
    }
    return GlobalMetricsCollector.instance;
  }

  public static getTaskEvents(taskId: string): EventData[] {
    return GlobalMetricsCollector.getInstance().getTaskEvents(taskId);
  }
}
