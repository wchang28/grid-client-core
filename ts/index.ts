import * as events from 'events';
import * as rcf from 'rcf';
import * as interf from './messaging';
import {Utils} from './utils';
import {IAutoScalableGrid, IAutoScalableState, IGridAutoScaler, IWorker, IWorkersLaunchRequest, WorkerKey, LaunchingWorker, TerminatingWorker, IGridAutoScalerJSON, AutoScalerImplementationInfo} from 'autoscalable-grid';

let eventStreamPathname = '/services/events/event_stream';
let clientOptions: rcf.IMessageClientOptions = {reconnetIntervalMS: 10000};

// TODO: in the future move this code to rcf
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
export type MessageCallback<MSG_TYPE> = (msg: MSG_TYPE, headers: rcf.IMsgHeaders) => void;

export interface IMessageClient<MSG_TYPE> {
    subscribe: (destination: string, cb: MessageCallback<MSG_TYPE>, headers?: {[field: string]: any;}) => Promise<string>;
    unsubscribe: (sub_id: string) => Promise<any>;
    send: (destination: string, headers: {[field: string]: any;}, msg: MSG_TYPE) => Promise<any>;
    disconnect: () => void;
    on: (event: string, listener: Function) => this;
}

export class MessageClient<MSG_TYPE> implements IMessageClient<MSG_TYPE> {
    constructor(protected __msgClient: rcf.IMessageClient, protected topicMountingPath: string = '') {}
    subscribe(destination: string, cb: MessageCallback<MSG_TYPE>, headers?: {[field: string]: any;}) : Promise<string> {
        return new Promise<any>((resolve: (value: any) => void, reject: (err: any) => void) => {
            let sub_id = this.__msgClient.subscribe(this.topicMountingPath + destination, (msg: rcf.IMessage) => {
                let m: MSG_TYPE = msg.body;
                cb(m, msg.headers);
            }, headers, (err: any) => {
                if (err)
                    reject(err);
                else
                    resolve(sub_id);
            });
        });
    }
    unsubscribe(sub_id: string) : Promise<any> {
        return new Promise<any>((resolve: (value: any) => void, reject: (err: any) => void) => {
            this.__msgClient.unsubscribe(sub_id, (err: any) => {
                if (err)
                    reject(err);
                else
                    resolve({});
            });
        });
    }
    send(destination: string, headers: {[field: string]: any}, msg: MSG_TYPE) : Promise<any> {
        return new Promise<any>((resolve: (value: any) => void, reject: (err: any) => void) => {
            this.__msgClient.send(this.topicMountingPath + destination, headers, msg, (err: any) => {
                if (err)
                    reject(err);
                else
                    resolve({});
            });
        });
    }
    disconnect() : void {this.__msgClient.disconnect();}
    on(event: string, listener: Function) : this {
        this.__msgClient.on(event, listener);
        return this;
    }
}
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export class ApiCore<MSG_TYPE> extends events.EventEmitter {
    private __authApi: rcf.AuthorizedRestApi
    constructor($drver: rcf.$Driver, access:rcf.OAuth2Access, tokenGrant: rcf.IOAuth2TokenGrant, protected topicMountingPath: string = '') {
        super();
        this.__authApi = new rcf.AuthorizedRestApi($drver, access, tokenGrant);
        this.__authApi.on('on_access_refreshed', (newAccess: rcf.OAuth2Access) => {
            this.emit('on_access_refreshed', newAccess);
        });
    }
    get $driver() : rcf.$Driver {return this.__authApi.$driver;}
    get access() : rcf.OAuth2Access {return this.__authApi.access;}
    get tokenGrant() : rcf.IOAuth2TokenGrant {return this.__authApi.tokenGrant;}
    get instance_url() :string {return this.__authApi.instance_url;}  
    $J(method: string, pathname: string, data: any) : Promise<any> {
        return new Promise<any>((resolve: (value: any) => void, reject: (err: any) => void) => {
            this.__authApi.$JP(method, pathname, data)
            .then((result: rcf.RestReturn) => {
                resolve(result.ret);
            }).catch((err: any) => {
                reject(err);
            });
        });
    }
    $M() : IMessageClient<MSG_TYPE> {return new MessageClient<MSG_TYPE>(this.__authApi.$M(eventStreamPathname, clientOptions), this.topicMountingPath);}
    mount(mountingPath: string, topicMountingPath: string = ''): ApiCore<MSG_TYPE> {
        let access:rcf.OAuth2Access = (this.__authApi.access ? JSON.parse(JSON.stringify(this.__authApi.access)) : {});
        access.instance_url = this.__authApi.instance_url + mountingPath;
        return new ApiCore<MSG_TYPE>(this.__authApi.$driver, access, this.tokenGrant, this.topicMountingPath + topicMountingPath);
    }
}

interface IJobSubmitter {
    submit: () => Promise<interf.IJobProgress>;
}

// job submission class
class JobSubmmit extends ApiCore<interf.GridMessage> implements IJobSubmitter {
    constructor($drver: rcf.$Driver, access:rcf.OAuth2Access, tokenGrant: rcf.IOAuth2TokenGrant, private __jobSubmit:interf.IGridJobSubmit) {
        super($drver, access, tokenGrant);
    }
    submit() : Promise<interf.IJobProgress> {
        return this.$J('POST', '/services/job/submit', this.__jobSubmit);
    }
}

// job re-submission class
class JobReSubmmit extends ApiCore<interf.GridMessage> implements IJobSubmitter {
    constructor($drver: rcf.$Driver, access:rcf.OAuth2Access, tokenGrant: rcf.IOAuth2TokenGrant, private __oldJobId:string, private __failedTasksOnly:boolean) {
        super($drver, access, tokenGrant);
    }
    submit() : Promise<interf.IJobProgress> {
        let path = Utils.getJobOpPath(this.__oldJobId, 're_submit');
        let data:any = {
            failedTasksOnly: (this.__failedTasksOnly ? '1' : '0')
        };
        return this.$J('GET', path, data);
    }
}

export interface IGridJob {
    jobId?:string;
    run() : void;
    on: (event: string, listener: Function) => this;
};

// will emit the follwoing events:
// 1. submitted (jobId)
// 2. status-changed (jobProgress: IJobProgress)
// 3. done (jobProgress: IJobProgress)
// 4. task-complete (task:ITask)
// 4. error
class GridJob extends ApiCore<interf.GridMessage> implements IGridJob {
    private __jobId:string = null;
    constructor($drver: rcf.$Driver, access:rcf.OAuth2Access, tokenGrant: rcf.IOAuth2TokenGrant, private __js:IJobSubmitter) {
        super($drver, access, tokenGrant);
    }
    private static jobDone(jobProgress: interf.IJobProgress) : boolean {
        return (jobProgress.status === 'FINISHED' || jobProgress.status === 'ABORTED');
    }
    private onError(msgClient: IMessageClient<interf.GridMessage>, err:any) : void {
        this.emit('error', err);
        if (msgClient) msgClient.disconnect();
    }
    // returns true if job is still running, false otherwise
    private onJobProgress(msgClient: IMessageClient<interf.GridMessage>, jp: interf.IJobProgress) : boolean {
        this.emit('status-changed', jp);
        if (Utils.jobDone(jp)) {
            if (msgClient) msgClient.disconnect();
            this.emit('done', jp);
            return false;
        } else
            return true;
    }
    run(): void {
        this.__js.submit()  // submit the job
        .then((jobProgress: interf.IJobProgress) => {
            // job submit successful
            this.__jobId = jobProgress.jobId;
            this.emit('submitted', this.__jobId);
            if (this.onJobProgress(null, jobProgress)) {
                // job still running
                let msgClient = this.$M();  // create a message client

                msgClient.on('connect', (conn_id:string) : void => {
                    // connected, try to subscribe to the job topic
                    msgClient.subscribe(Utils.getJobNotificationTopic(this.jobId), (gMsg: interf.GridMessage) => {
                        if (gMsg.type === 'status-changed') {
                            let jobProgress: interf.IJobProgress = gMsg.content;
                            this.onJobProgress(msgClient, jobProgress);
                        } else if (gMsg.type === 'task-complete') {
                            let task:interf.ITask = gMsg.content;
                            this.emit('task-complete', task);
                        }
                    }
                    ,{})
                    .then((sub_id: string) => {
                        // job topic subscription successful, try to get the job progress again
                        let path = Utils.getJobOpPath(this.jobId, 'progress');
                        this.$J("GET", path, {})
                        .then((jobProgress:interf.IJobProgress) => {
                            this.onJobProgress(msgClient, jobProgress);
                        }).catch((err: any) => {
                            this.onError(msgClient, err);
                        })
                    }).catch((err: any) => {
                        // job topic subscription failed
                        this.onError(msgClient, err);
                    });
                }).on('error', (err: any) : void => {
                    // message client error
                    this.onError(msgClient, err);
                });
            }
        }).catch((err: any) => {
            // job submit failed
            this.onError(null, err);
        });
    }

    get jobId() : string {return this.__jobId;}
}

class AutoScalableGrid implements IAutoScalableGrid {
    constructor(private api: ApiCore<interf.GridMessage>) {}
    getWorkers(workerIds: string[]) : Promise<IWorker[]> {return this.api.$J("GET", "/get_workers", workerIds);}
    disableWorkers(workerIds: string[]) : Promise<any> {return this.api.$J("POST", "/disable_workers", workerIds);}
    setWorkersTerminating(workerIds: string[]) : Promise<any> {return this.api.$J("POST", "/set_workers_terminating", workerIds);}
    getCurrentState() : Promise<IAutoScalableState> {return this.api.$J("GET", "/state", {});}
}

class GridAutoScaler implements IGridAutoScaler {
    constructor(private api: ApiCore<interf.GridMessage>) {}
    isScalingUp(): Promise<boolean> {return this.api.$J("GET", "/is_scaling_up", {});}
    launchNewWorkers(launchRequest: IWorkersLaunchRequest): Promise<LaunchingWorker[]> {return this.api.$J("POST", "/launch_new_workers", launchRequest);}
    terminateWorkers(workers: IWorker[]): Promise<TerminatingWorker[]> {return this.api.$J("POST", "/terminate_workers", workers);}
    isEnabled(): Promise<boolean> {return this.api.$J("GET", "/is_enabled", {});}
    enable(): Promise<any> {return this.api.$J("POST", "/enable", {});}
    disable(): Promise<any> {return this.api.$J("POST", "/disable", {});}
    hasMaxWorkersCap(): Promise<boolean> {return this.api.$J("GET", "/has_max_workers_cap", {});}
    hasMinWorkersCap(): Promise<boolean> {return this.api.$J("GET", "/has_min_workers_cap", {});}
    getMaxWorkersCap(): Promise<number> {return this.api.$J("GET", "/get_max_workers_cap", {});}
    setMaxWorkersCap(value: number): Promise<number> {return this.api.$J("POST", "/set_max_workers_cap", value);}
    getMinWorkersCap(): Promise<number> {return this.api.$J("GET", "/get_min_workers_cap", {});}
    setMinWorkersCap(value: number): Promise<number> {return this.api.$J("POST", "/set_min_workers_cap", value);}
    getLaunchingTimeoutMinutes (): Promise<number> {return this.api.$J("GET", "/get_launching_timeout_minutes", {});}
    setLaunchingTimeoutMinutes (value: number): Promise<number> {return this.api.$J("POST", "/set_launching_timeout_minutes", value);}
    getTerminateWorkerAfterMinutesIdle(): Promise<number> {return this.api.$J("GET", "/get_terminate_worker_after_minutes_idle", {});}
    setTerminateWorkerAfterMinutesIdle(value: number): Promise<number> {return this.api.$J("POST", "/set_terminate_worker_after_minutes_idle", value);}
    getRampUpSpeedRatio(): Promise<number> {return this.api.$J("GET", "/get_ramp_up_speed_ratio", {});}
    setRampUpSpeedRatio(value: number): Promise<number> {return this.api.$J("POST", "/set_ramp_up_speed_ratio", value);}
    getLaunchingWorkers(): Promise<LaunchingWorker[]> {return this.api.$J("GET", "/get_launching_workers", {});}
    getJSON(): Promise<IGridAutoScalerJSON> {return this.api.$J("GET", "/", {});}
    getImplementationInfo(): Promise<AutoScalerImplementationInfo> {return this.api.$J("GET", "/get_impl_info", {});}
}

export interface ISessionBase {
    createMsgClient: () => IMessageClient<interf.GridMessage>;
    readonly AutoScalableGrid: IAutoScalableGrid;
    readonly GridAutoScaler: IGridAutoScaler;
    readonly AutoScalerImplementationApiCore: ApiCore<interf.GridMessage>;
    getTimes: () => Promise<interf.Times>;
    autoScalerAvailable: () => Promise<boolean>;
    runJob: (jobSubmit:interf.IGridJobSubmit) => IGridJob;
    sumbitJob: (jobSubmit:interf.IGridJobSubmit) => Promise<interf.IJobProgress>;
    reRunJob: (oldJobId:string, failedTasksOnly:boolean) => IGridJob;
    reSumbitJob: (oldJobId:string, failedTasksOnly:boolean) => Promise<interf.IJobProgress>;
    getMostRecentJobs: () => Promise<interf.IJobInfo[]>;
    killJob: (jobId: string) => Promise<any>;
    getJobProgress: (jobId: string) => Promise<interf.IJobProgress>;
    getJobInfo: (jobId: string) => Promise<interf.IJobInfo>;
    getJobResult: (jobId: string) => Promise<interf.IJobResult>;
    getDispatcherJSON: () => Promise<interf.IDispatcherJSON>;
    setDispatchingEnabled: (enabled: boolean) => Promise<interf.IDispControl>; 
    setQueueOpened: (open: boolean) => Promise<interf.IDispControl>;
    getConnections: () => Promise<any>;
    setNodeEnabled: (nodeId:string, enabled: boolean) => Promise<interf.INodeItem>;
    getTaskResult: (jobId: string, taskIndex: number) => Promise<interf.ITaskResult>;
}

export interface ISession extends ISessionBase {
    logout: () => Promise<any>;
}

export class SessionBase extends ApiCore<interf.GridMessage> implements ISessionBase {
    constructor($drver: rcf.$Driver, access: rcf.OAuth2Access, tokenGrant: rcf.IOAuth2TokenGrant) {
        super($drver, access, tokenGrant);
    }
    createMsgClient() : IMessageClient<interf.GridMessage> {
        return this.$M();
    }
    get AutoScalableGrid(): IAutoScalableGrid {return new AutoScalableGrid(this.mount('/services/scalable'));}
    get GridAutoScaler(): IGridAutoScaler {return new GridAutoScaler(this.mount('/services/autoscaler'));}
    get AutoScalerImplementationApiCore() : ApiCore<interf.GridMessage> {
        return this.mount(Utils.getAutoScalerImplementationApiBasePath(), Utils.getAutoScalerImplementationTopic());
    }
    getTimes(): Promise<interf.Times> {return this.$J("GET", '/services/times', {});}
    autoScalerAvailable(): Promise<boolean> {return this.$J("GET", '/services/autoscaler_available', {});}
    runJob(jobSubmit:interf.IGridJobSubmit) : IGridJob {
        let js = new JobSubmmit(this.$driver, this.access, this.tokenGrant, jobSubmit);
        return new GridJob(this.$driver, this.access, this.tokenGrant, js);
    }
    sumbitJob(jobSubmit:interf.IGridJobSubmit) : Promise<interf.IJobProgress> {
        let js = new JobSubmmit(this.$driver, this.access, this.tokenGrant, jobSubmit);
        return js.submit();
    }
    reRunJob(oldJobId:string, failedTasksOnly:boolean) : IGridJob {
        let js = new JobReSubmmit(this.$driver, this.access, this.tokenGrant, oldJobId, failedTasksOnly);
        return new GridJob(this.$driver, this.access, this.tokenGrant, js);
    }
    reSumbitJob(oldJobId:string, failedTasksOnly:boolean) : Promise<interf.IJobProgress> {
        let js = new JobReSubmmit(this.$driver, this.access, this.tokenGrant, oldJobId, failedTasksOnly);
        return js.submit();
    }
    getMostRecentJobs() : Promise<interf.IJobInfo[]> {return this.$J("GET", '/services/job/most_recent', {});}
    killJob(jobId: string) : Promise<any> {
        let path = Utils.getJobOpPath(jobId, 'kill');
        return this.$J("GET", path, {});
    }
    getJobProgress(jobId: string) : Promise<interf.IJobProgress> {
        let path = Utils.getJobOpPath(jobId, 'progress');
        return this.$J("GET", path, {});
    }
    getJobInfo(jobId: string) : Promise<interf.IJobInfo> {
        let path = Utils.getJobOpPath(jobId, 'info');
        return this.$J("GET", path, {});
    }
    getJobResult(jobId: string) : Promise<interf.IJobResult> {
        let path = Utils.getJobOpPath(jobId, 'result');
        return this.$J("GET", path, {});
    }
    getDispatcherJSON() : Promise<interf.IDispatcherJSON> {return this.$J("GET", '/services/dispatcher', {});}
    setDispatchingEnabled(enabled: boolean): Promise<interf.IDispControl> {
        let path = "/services/dispatcher/dispatching/" + (enabled? "start": "stop");
        return this.$J("GET", path, {});
    }
    setQueueOpened(open: boolean) : Promise<interf.IDispControl> {
        let path = "/services/dispatcher/queue/" + (open? "open": "close");
        return this.$J("GET", path, {});
    }
    getConnections() : Promise<any> {return this.$J("GET", '/services/connections', {});}
    setNodeEnabled(nodeId:string, enabled: boolean): Promise<interf.INodeItem> {
        let path = Utils.getNodePath(nodeId, (enabled ? "enable": "disable"));
        return this.$J("GET", path, {});
    }
    getTaskResult(jobId: string, taskIndex: number) : Promise<interf.ITaskResult> {
        let path = Utils.getTaskOpPath(jobId, taskIndex);
        return this.$J("GET", path, {});
    }
}

export {$Driver, OAuth2Access, IOAuth2TokenGrant} from 'rcf';
export {Utils} from  './utils';
export * from './messaging';
export * from 'autoscalable-grid';