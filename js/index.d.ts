/// <reference types="node" />
import * as events from 'events';
import * as rcf from 'rcf';
import * as interf from './messaging';
export interface MessageCallback {
    (msg: interf.GridMessage): void;
}
export interface IMessageClient {
    subscribe: (destination: string, cb: MessageCallback, headers?: {
        [field: string]: any;
    }, done?: rcf.DoneHandler) => string;
    unsubscribe: (sub_id: string, done?: rcf.DoneHandler) => void;
    send: (destination: string, headers: {
        [field: string]: any;
    }, msg: interf.GridMessage, done?: rcf.DoneHandler) => void;
    disconnect: () => void;
    on: (event: string, listener: Function) => this;
}
export declare class ApiCore extends events.EventEmitter {
    private __authApi;
    constructor($drver: rcf.$Driver, access: rcf.OAuth2Access, tokenGrant: rcf.IOAuth2TokenGrant);
    readonly $driver: rcf.$Driver;
    readonly access: rcf.OAuth2Access;
    readonly tokenGrant: rcf.IOAuth2TokenGrant;
    $J(method: string, pathname: string, data: any, done: rcf.ApiCompletionHandler): void;
    $M(): IMessageClient;
}
export interface IGridJob {
    jobId?: string;
    run(): void;
    on: (event: string, listener: Function) => this;
}
export interface ISession {
    createMsgClient: () => IMessageClient;
    runJob: (jobSubmit: interf.IGridJobSubmit) => IGridJob;
    sumbitJob: (jobSubmit: interf.IGridJobSubmit, done: (err: any, jobProgress: interf.IJobProgress) => void) => void;
    reRunJob: (oldJobId: string, failedTasksOnly: boolean) => IGridJob;
    reSumbitJob: (oldJobId: string, failedTasksOnly: boolean, done: (err: any, jobProgress: interf.IJobProgress) => void) => void;
    getMostRecentJobs: (done: (err: any, jobInfos: interf.IJobInfo[]) => void) => void;
    killJob: (jobId: string, done: (err: any, ret: any) => void) => void;
    getJobProgress: (jobId: string, done: (err: any, jobProgress: interf.IJobProgress) => void) => void;
    getJobInfo: (jobId: string, done: (err: any, jobInfo: interf.IJobInfo) => void) => void;
    getJobResult: (jobId: string, done: (err: any, jobResult: interf.IJobResult) => void) => void;
    getDispatcherJSON: (done: (err: any, dispatcherJSON: interf.IDispatcherJSON) => void) => void;
    setDispatchingEnabled: (enabled: boolean, done: (err: any, dispControl: interf.IDispControl) => void) => void;
    setQueueOpened: (open: boolean, done: (err: any, dispControl: interf.IDispControl) => void) => void;
    getConnections: (done: (err: any, connections: any) => void) => void;
    setNodeEnabled: (nodeId: string, enabled: boolean, done: (err: any, nodeItem: interf.INodeItem) => void) => void;
    getTaskResult: (jobId: string, taskIndex: number, done: (err: any, taskResult: interf.ITaskResult) => void) => void;
    logout: (done?: (err: any) => void) => void;
}
export declare class SessionBase extends ApiCore {
    constructor($drver: rcf.$Driver, access: rcf.OAuth2Access, tokenGrant: rcf.IOAuth2TokenGrant);
    createMsgClient(): IMessageClient;
    runJob(jobSubmit: interf.IGridJobSubmit): IGridJob;
    sumbitJob(jobSubmit: interf.IGridJobSubmit, done: (err: any, jobProgress: interf.IJobProgress) => void): void;
    reRunJob(oldJobId: string, failedTasksOnly: boolean): IGridJob;
    reSumbitJob(oldJobId: string, failedTasksOnly: boolean, done: (err: any, jobProgress: interf.IJobProgress) => void): void;
    getMostRecentJobs(done: (err: any, jobInfos: interf.IJobInfo[]) => void): void;
    killJob(jobId: string, done: (err: any, ret: any) => void): void;
    getJobProgress(jobId: string, done: (err: any, jobProgress: interf.IJobProgress) => void): void;
    getJobInfo(jobId: string, done: (err: any, jobInfo: interf.IJobInfo) => void): void;
    getJobResult(jobId: string, done: (err: any, jobResult: interf.IJobResult) => void): void;
    getDispatcherJSON(done: (err: any, dispatcherJSON: interf.IDispatcherJSON) => void): void;
    setDispatchingEnabled(enabled: boolean, done: (err: any, dispControl: interf.IDispControl) => void): void;
    setQueueOpened(open: boolean, done: (err: any, dispControl: interf.IDispControl) => void): void;
    getConnections(done: (err: any, connections: any) => void): void;
    setNodeEnabled(nodeId: string, enabled: boolean, done: (err: any, nodeItem: interf.INodeItem) => void): void;
    getTaskResult(jobId: string, taskIndex: number, done: (err: any, taskResult: interf.ITaskResult) => void): void;
}
export { $Driver, OAuth2Access, IOAuth2TokenGrant } from 'rcf';
export { Utils } from './utils';
export * from './messaging';
