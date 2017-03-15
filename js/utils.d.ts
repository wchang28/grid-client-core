import * as msg from './messaging';
export declare class Utils {
    static jobDone(jobProgress: msg.IJobProgress): boolean;
    static getDispatcherTopic(): string;
    static getJobsTrackingTopic(): string;
    static getConnectionsTopic(): string;
    static getAutoScalerTopic(): string;
    static getAutoScalerImplementation(): string;
    static getJobNotificationTopic(jobId: string): string;
    static getJobOpPath(jobId: string, op: string): string;
    static getNodePath(nodeId: string, op: string): string;
    static getTaskOpPath(jobId: string, taskIndex: number, op?: string): string;
}
