/// <reference types="es6-promise" />
/// <reference types="node" />
import * as events from 'events';
import * as rcf from 'rcf';
import * as interf from './messaging';
import { IAutoScalableGrid, IGridAutoScaler } from 'autoscalable-grid';
export interface MessageCallbackT<M> {
    (msg: M, headers: rcf.IMsgHeaders): void;
}
export interface IMessageClientT<M> {
    subscribe: (destination: string, cb: MessageCallbackT<M>, headers?: {
        [field: string]: any;
    }) => Promise<string>;
    unsubscribe: (sub_id: string) => Promise<any>;
    send: (destination: string, headers: {
        [field: string]: any;
    }, msg: M) => Promise<any>;
    disconnect: () => void;
    on: (event: string, listener: Function) => this;
}
export declare type MessageCallback = MessageCallbackT<interf.GridMessage>;
export interface IMessageClient {
    subscribe: (destination: string, cb: MessageCallback, headers?: {
        [field: string]: any;
    }) => Promise<string>;
    unsubscribe: (sub_id: string) => Promise<any>;
    send: (destination: string, headers: {
        [field: string]: any;
    }, msg: interf.GridMessage) => Promise<any>;
    disconnect: () => void;
    on: (event: string, listener: Function) => this;
}
export declare class ApiCore extends events.EventEmitter {
    protected topicMountingPath: string;
    private __authApi;
    constructor($drver: rcf.$Driver, access: rcf.OAuth2Access, tokenGrant: rcf.IOAuth2TokenGrant, topicMountingPath?: string);
    readonly $driver: rcf.$Driver;
    readonly access: rcf.OAuth2Access;
    readonly tokenGrant: rcf.IOAuth2TokenGrant;
    readonly instance_url: string;
    $J(method: string, pathname: string, data: any): Promise<any>;
    $M(): IMessageClient;
}
export interface IGridJob {
    jobId?: string;
    run(): void;
    on: (event: string, listener: Function) => this;
}
export interface IAutoScalerImplementation$ {
    $J: (method: string, pathname: string, data: any) => Promise<any>;
    $M: () => IMessageClient;
}
export interface ISessionBase {
    createMsgClient: () => IMessageClient;
    readonly AutoScalableGrid: IAutoScalableGrid;
    readonly GridAutoScaler: IGridAutoScaler;
    getTimes: () => Promise<interf.Times>;
    autoScalerAvailable: () => Promise<boolean>;
    runJob: (jobSubmit: interf.IGridJobSubmit) => IGridJob;
    sumbitJob: (jobSubmit: interf.IGridJobSubmit) => Promise<interf.IJobProgress>;
    reRunJob: (oldJobId: string, failedTasksOnly: boolean) => IGridJob;
    reSumbitJob: (oldJobId: string, failedTasksOnly: boolean) => Promise<interf.IJobProgress>;
    getMostRecentJobs: () => Promise<interf.IJobInfo[]>;
    killJob: (jobId: string) => Promise<any>;
    getJobProgress: (jobId: string) => Promise<interf.IJobProgress>;
    getJobInfo: (jobId: string) => Promise<interf.IJobInfo>;
    getJobResult: (jobId: string) => Promise<interf.IJobResult>;
    getDispatcherJSON: () => Promise<interf.IDispatcherJSON>;
    setDispatchingEnabled: (enabled: boolean) => Promise<interf.IDispControl>;
    setQueueOpened: (open: boolean) => Promise<interf.IDispControl>;
    getConnections: () => Promise<any>;
    setNodeEnabled: (nodeId: string, enabled: boolean) => Promise<interf.INodeItem>;
    getTaskResult: (jobId: string, taskIndex: number) => Promise<interf.ITaskResult>;
}
export interface ISession extends ISessionBase {
    logout: () => Promise<any>;
}
export declare class SessionBase extends ApiCore implements ISessionBase {
    constructor($drver: rcf.$Driver, access: rcf.OAuth2Access, tokenGrant: rcf.IOAuth2TokenGrant);
    createMsgClient(): IMessageClient;
    readonly AutoScalableGrid: IAutoScalableGrid;
    readonly GridAutoScaler: IGridAutoScaler;
    readonly AutoScalerImplementation$: IAutoScalerImplementation$;
    getTimes(): Promise<interf.Times>;
    autoScalerAvailable(): Promise<boolean>;
    runJob(jobSubmit: interf.IGridJobSubmit): IGridJob;
    sumbitJob(jobSubmit: interf.IGridJobSubmit): Promise<interf.IJobProgress>;
    reRunJob(oldJobId: string, failedTasksOnly: boolean): IGridJob;
    reSumbitJob(oldJobId: string, failedTasksOnly: boolean): Promise<interf.IJobProgress>;
    getMostRecentJobs(): Promise<interf.IJobInfo[]>;
    killJob(jobId: string): Promise<any>;
    getJobProgress(jobId: string): Promise<interf.IJobProgress>;
    getJobInfo(jobId: string): Promise<interf.IJobInfo>;
    getJobResult(jobId: string): Promise<interf.IJobResult>;
    getDispatcherJSON(): Promise<interf.IDispatcherJSON>;
    setDispatchingEnabled(enabled: boolean): Promise<interf.IDispControl>;
    setQueueOpened(open: boolean): Promise<interf.IDispControl>;
    getConnections(): Promise<any>;
    setNodeEnabled(nodeId: string, enabled: boolean): Promise<interf.INodeItem>;
    getTaskResult(jobId: string, taskIndex: number): Promise<interf.ITaskResult>;
}
export { $Driver, OAuth2Access, IOAuth2TokenGrant } from 'rcf';
export { Utils } from './utils';
export * from './messaging';
export * from 'autoscalable-grid';
