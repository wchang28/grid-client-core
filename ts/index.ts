import * as events from 'events';
import * as rcf from 'rcf';
import * as interf from './messaging';
import {Utils} from './utils';
import {IAutoScalableGrid, IAutoScalableState, IGridAutoScaler, IWorker, IWorkersLaunchRequest, WorkerKey, IGridAutoScalerJSON} from 'autoscalable-grid';

let eventStreamPathname = '/services/events/event_stream';
let clientOptions: rcf.IMessageClientOptions = {reconnetIntervalMS: 10000};

export interface MessageCallback {
    (msg: interf.GridMessage, headers: rcf.IMsgHeaders): void;
}

export interface IMessageClient {
    subscribe: (destination: string, cb: MessageCallback, headers?: {[field: string]: any;}) => Promise<string>;
    unsubscribe: (sub_id: string) => Promise<any>;
    send: (destination: string, headers: {[field: string]: any;}, msg: interf.GridMessage) => Promise<any>;
    disconnect: () => void;
    on: (event: string, listener: Function) => this;
}

class MessageClient implements IMessageClient {
    constructor(protected __msgClient: rcf.IMessageClient) {}
    subscribe(destination: string, cb: MessageCallback, headers?: {[field: string]: any;}) : Promise<string> {
        return new Promise<any>((resolve: (value: any) => void, reject: (err: any) => void) => {
            let sub_id = this.__msgClient.subscribe(destination, (msg: rcf.IMessage) => {
                let gMsg: interf.GridMessage = msg.body;
                cb(gMsg, msg.headers);
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
    send(destination: string, headers: {[field: string]: any}, msg: interf.GridMessage) : Promise<any> {
        return new Promise<any>((resolve: (value: any) => void, reject: (err: any) => void) => {
            this.__msgClient.send(destination, headers, msg, (err: any) => {
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

export class ApiCore extends events.EventEmitter {
    private __authApi: rcf.AuthorizedRestApi
    constructor($drver: rcf.$Driver, access:rcf.OAuth2Access, tokenGrant: rcf.IOAuth2TokenGrant) {
        super();
        this.__authApi = new rcf.AuthorizedRestApi($drver, access, tokenGrant);
        this.__authApi.on('on_access_refreshed', (newAccess: rcf.OAuth2Access) => {
            this.emit('on_access_refreshed', newAccess);
        });
    }
    get $driver() : rcf.$Driver {return this.__authApi.$driver;}
    get access() : rcf.OAuth2Access {return this.__authApi.access;}
    get tokenGrant() : rcf.IOAuth2TokenGrant {return this.__authApi.tokenGrant;}
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
    $M() : IMessageClient {
        return new MessageClient(this.__authApi.$M(eventStreamPathname, clientOptions));
    }
}

interface IJobSubmitter {
    submit: () => Promise<interf.IJobProgress>;
}

// job submission class
class JobSubmmit extends ApiCore implements IJobSubmitter {
    constructor($drver: rcf.$Driver, access:rcf.OAuth2Access, tokenGrant: rcf.IOAuth2TokenGrant, private __jobSubmit:interf.IGridJobSubmit) {
        super($drver, access, tokenGrant);
    }
    submit() : Promise<interf.IJobProgress> {
        return this.$J('POST', '/services/job/submit', this.__jobSubmit);
    }
}

// job re-submission class
class JobReSubmmit extends ApiCore implements IJobSubmitter {
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
class GridJob extends ApiCore implements IGridJob {
    private __jobId:string = null;
    constructor($drver: rcf.$Driver, access:rcf.OAuth2Access, tokenGrant: rcf.IOAuth2TokenGrant, private __js:IJobSubmitter) {
        super($drver, access, tokenGrant);
    }
    private static jobDone(jobProgress: interf.IJobProgress) : boolean {
        return (jobProgress.status === 'FINISHED' || jobProgress.status === 'ABORTED');
    }
    private onError(msgClient: IMessageClient, err:any) : void {
        this.emit('error', err);
        if (msgClient) msgClient.disconnect();
    }
    // returns true if job is still running, false otherwise
    private onJobProgress(msgClient: IMessageClient, jp: interf.IJobProgress) : boolean {
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
    constructor(private api: ApiCore) {}
    getWorkers(workerIds: string[]) : Promise<IWorker[]> {return this.api.$J("GET", "/services/scalable/get_workers", workerIds);}
    disableWorkers(workerIds: string[]) : Promise<any> {return this.api.$J("POST", "/services/scalable/disable_workers", workerIds);}
    setWorkersTerminating(workerIds: string[]) : Promise<any> {return this.api.$J("POST", "/services/scalable/set_workers_terminating", workerIds);}
    getCurrentState() : Promise<IAutoScalableState> {return this.api.$J("GET", "/services/scalable/state", {});}
}

class GridAutoScaler implements IGridAutoScaler {
    constructor(private api: ApiCore) {}
    isScalingUp(): Promise<boolean> {return this.api.$J("GET", "/services/autoscaler/is_scaling_up", {});}
    launchNewWorkers(launchRequest: IWorkersLaunchRequest): Promise<boolean> {return this.api.$J("POST", "/services/autoscaler/launch_new_workers", launchRequest);}
    terminateWorkers(workers: IWorker[]): Promise<boolean> {return this.api.$J("POST", "/services/autoscaler/terminate_workers", workers);}
    isEnabled(): Promise<boolean> {return this.api.$J("GET", "/services/autoscaler/is_enabled", {});}
    enable(): Promise<any> {return this.api.$J("POST", "/services/autoscaler/enable", {});}
    disable(): Promise<any> {return this.api.$J("POST", "/services/autoscaler/disable", {});}
    hasMaxWorkersCap(): Promise<boolean> {return this.api.$J("GET", "/services/autoscaler/has_max_workers_cap", {});}
    hasMinWorkersCap(): Promise<boolean> {return this.api.$J("GET", "/services/autoscaler/has_min_workers_cap", {});}
    getMaxWorkersCap(): Promise<number> {return this.api.$J("GET", "/services/autoscaler/get_max_workers_cap", {});}
    setMaxWorkersCap(value: number): Promise<number> {return this.api.$J("POST", "/services/autoscaler/set_max_workers_cap", value);}
    getMinWorkersCap(): Promise<number> {return this.api.$J("GET", "/services/autoscaler/get_min_workers_cap", {});}
    setMinWorkersCap(value: number): Promise<number> {return this.api.$J("POST", "/services/autoscaler/set_min_workers_cap", value);}
    getLaunchingWorkers(): Promise<WorkerKey[]> {return this.api.$J("GET", "/services/autoscaler/get_launching_workers", {});}
    getJSON(): Promise<IGridAutoScalerJSON> {return this.api.$J("GET", "/services/autoscaler", {});}
    getImplementationConfigUrl(): Promise<string> {return this.api.$J("GET", "/services/autoscaler/get_impl_config_url", {});}
}

export interface ISessionBase {
    createMsgClient: () => IMessageClient;
    readonly AutoScalableGrid: IAutoScalableGrid;
    readonly GridAutoScaler: IGridAutoScaler;
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

export class SessionBase extends ApiCore implements ISessionBase {
    constructor($drver: rcf.$Driver, access: rcf.OAuth2Access, tokenGrant: rcf.IOAuth2TokenGrant) {
        super($drver, access, tokenGrant);
    }
    createMsgClient() : IMessageClient {
        return this.$M();
    }
    get AutoScalableGrid(): IAutoScalableGrid {return new AutoScalableGrid(this);}
    get GridAutoScaler(): IGridAutoScaler {return new GridAutoScaler(this);}
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