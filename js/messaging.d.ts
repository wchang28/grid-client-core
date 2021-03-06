export interface GridMessage {
    type: string;
    content: any;
}
export interface IGridUserProfile {
    id: string;
    name: string;
    priority: number;
    canSubmitJob: boolean;
    canKillOtherUsersJob: boolean;
    canStartStopDispatching: boolean;
    canOpenCloseQueue: boolean;
    canEnableDisableNode: boolean;
    canChangeAutoScalerSettings: boolean;
}
export interface IGridUser {
    userId: string;
    userName: string;
    displayName: string;
    email: string;
    profile: IGridUserProfile;
}
export interface INode {
    id: string;
    name: string;
    remoteAddress: string;
    remotePort: number;
}
export interface INodeItem extends INode {
    enabled: boolean;
    numCPUs: number;
    cpusUsed: number;
    terminating: boolean;
    lastIdleTime?: number;
}
export interface INodeReady {
    numCPUs: number;
    name?: string;
}
export interface ITask {
    j: string;
    t: number;
}
export interface IQueueJSON {
    priorities: number[];
    numJobs: number;
    numTasks: number;
}
export interface IDispControl {
    queueClosed: boolean;
    dispatchEnabled: boolean;
}
export interface IDispStates {
    dispatching: boolean;
    numOutstandingAcks: number;
}
export interface IJobsStatusPollingJSON {
    started: boolean;
}
export interface IDispatcherJSON {
    nodes: INodeItem[];
    queue: IQueueJSON;
    dispControl: IDispControl;
    states: IDispStates;
    jobsPolling: IJobsStatusPollingJSON;
}
export interface IJobProgress {
    jobId: string;
    status: string;
    numTasks: number;
    numTasksFinished: number;
    success: boolean;
}
export interface IJobInfo extends IJobProgress {
    description: string;
    cookie: string;
    userId: string;
    userName: string;
    priority: number;
    submitTime: Date;
    startTime: Date;
    finishTime: Date;
    durationSeconds: number;
    completePct: number;
}
export interface ITaskResult {
    t: number;
    cookie?: string;
    success?: boolean;
    retCode?: number;
    stdout?: string;
    stderr?: string;
}
export declare type IJobResult = ITaskResult[];
export interface INodeRunningProcess {
    nodeId: string;
    pid: number;
}
export interface IRunningProcessByNode {
    [nodeId: string]: number[];
}
export interface ITaskExecParams {
    cmd: string;
    stdin?: string;
    envJSON?: string;
}
export interface ITaskExecResult {
    pid: number;
    retCode: number;
    stdout: string;
    stderr: string;
}
export interface ITaskItem {
    cmd: string;
    cookie?: string;
    stdin?: string;
    envJSON?: string;
}
export interface IGridJobSubmit {
    description?: string;
    cookie?: string;
    tasks: ITaskItem[];
}
export interface Times {
    serverTime: number;
    dbTime: number;
}
export interface ITaskRunningStatus extends ITask {
    cmd?: string;
    envJSON?: string;
    pid?: number;
}
export interface NodeQueryStatus {
    FreeMem: number;
    TotalMem: number;
    UptimeSec: number;
    RunningTasks: ITaskRunningStatus[];
}
export interface NodeQueryStatusRequest {
    QueryId: string;
}
export interface NodeQueryStatusResponse {
    QueryId: string;
    Status: NodeQueryStatus;
}
