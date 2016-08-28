import * as events from 'events';
import * as rcf from 'rcf';
import * as interf from './messaging';
import {Utils} from './utils';

let eventStreamPathname = '/services/events/event_stream';
let clientOptions: rcf.IMessageClientOptions = {reconnetIntervalMS: 10000};

export interface MessageCallback {
    (msg: interf.GridMessage): void;
}

export interface IMessageClient {
    subscribe: (destination: string, cb: MessageCallback, headers?: {[field: string]: any;}, done?: rcf.DoneHandler) => string;
    unsubscribe: (sub_id: string, done?: rcf.DoneHandler) => void;
    send: (destination: string, headers: {[field: string]: any;}, msg: interf.GridMessage, done?: rcf.DoneHandler) => void;
    disconnect: () => void;
    on: (event: string, listener: Function) => this;
}

class MessageClient implements IMessageClient {
    constructor(protected __msgClient: rcf.IMessageClient) {}
    subscribe(destination: string, cb: MessageCallback, headers?: {[field: string]: any;}, done?: rcf.DoneHandler) : string {
        return this.__msgClient.subscribe(destination, (msg: rcf.IMessage) => {
            let gMsg: interf.GridMessage = msg.body;
            cb(gMsg);
        }, headers, done);
    }
    unsubscribe(sub_id: string, done?: rcf.DoneHandler) : void {this.__msgClient.unsubscribe(sub_id, done);}
    send(destination: string, headers: {[field: string]: any}, msg: interf.GridMessage, done?: rcf.DoneHandler) : void {
        this.__msgClient.send(destination, headers, msg, done);
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
    $J(method: string, pathname: string, data: any, done: rcf.ApiCompletionHandler) : void {
        this.__authApi.$J(method, pathname, data, done);
    }
    $M() : IMessageClient {
        return new MessageClient(this.__authApi.$M(eventStreamPathname, clientOptions));
    }
}

interface IJobSubmitter {
    submit: (done: (err:any, jobProgress:interf.IJobProgress) => void) => void;
}

// job submission class
class JobSubmmit extends ApiCore implements IJobSubmitter {
    constructor($drver: rcf.$Driver, access:rcf.OAuth2Access, tokenGrant: rcf.IOAuth2TokenGrant, private __jobSubmit:interf.IGridJobSubmit) {
        super($drver, access, tokenGrant);
    }
    submit(done: (err:any, jobProgress:interf.IJobProgress) => void) : void {
        this.$J('POST', '/services/job/submit', this.__jobSubmit, (err:any, ret:any) => {
            done(err, (err ? null: ret));
        });
    }
}

// job re-submission class
class JobReSubmmit extends ApiCore implements IJobSubmitter {
    constructor($drver: rcf.$Driver, access:rcf.OAuth2Access, tokenGrant: rcf.IOAuth2TokenGrant, private __oldJobId:string, private __failedTasksOnly:boolean) {
        super($drver, access, tokenGrant);
    }
    submit(done: (err:any, jobProgress:interf.IJobProgress) => void) : void {
        let path = Utils.getJobOpPath(this.__oldJobId, 're_submit');
        let data:any = {
            failedTasksOnly: (this.__failedTasksOnly ? '1' : '0')
        };
        this.$J('GET', path, data, (err: any, ret: any) => {
            done(err, (err ? null: ret));
        });
    }
}

export interface IGridJob {
    jobId?:string;
    run() : void;
    on: (event: string, listener: Function) => this;
};

// will emit the follwoing events:
// 1. submitted (jobId)
// 2. status-changed (jobProgress)
// 3. done (jobProgress)
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
        // submit the job
        this.__js.submit((err:any, jobProgress: interf.IJobProgress) => {
            if (err) {  // submit failed
                this.onError(null, err);
            } else {    // submit successful
                this.__jobId = jobProgress.jobId;
                this.emit('submitted', this.__jobId);
                if (this.onJobProgress(null, jobProgress)) {
                    let msgClient = this.$M();

                    msgClient.on('connect', (conn_id:string) : void => {
                        msgClient.subscribe(Utils.getJobNotificationTopic(this.jobId), (gMsg: interf.GridMessage) => {
                            if (gMsg.type === 'status-changed') {
                                let jobProgress: interf.IJobProgress = gMsg.content;
                                this.onJobProgress(msgClient, jobProgress);
                            }
                        }
                        ,{}
                        ,(err: any) => {
                            if (err) {  // topic subscription failed
                                this.onError(msgClient, err);
                            } else {  // topic subscription successful
                                let path = Utils.getJobOpPath(this.jobId, 'progress');
                                this.$J("GET", path, {}, (err:any, jobProgress:interf.IJobProgress) => {
                                    this.onJobProgress(msgClient, jobProgress);
                                });
                            }
                        });
                    });

                    msgClient.on('error', (err: any) : void => {
                        this.onError(msgClient, err);
                    });
                }
            }
        });
    }

    get jobId() : string {return this.__jobId;}
}

export interface ISession {
    createMsgClient: () => IMessageClient;
    runJob: (jobSubmit:interf.IGridJobSubmit) => IGridJob;
    sumbitJob: (jobSubmit:interf.IGridJobSubmit, done: (err:any, jobProgress:interf.IJobProgress) => void) => void;
    reRunJob: (oldJobId:string, failedTasksOnly:boolean) => IGridJob;
    reSumbitJob: (oldJobId:string, failedTasksOnly:boolean, done: (err:any, jobProgress:interf.IJobProgress) => void) => void;
    getMostRecentJobs: (done: (err:any, jobInfos:interf.IJobInfo[]) => void) => void;
    killJob: (jobId: string, done: (err:any, ret:any) => void) => void;
    getJobProgress: (jobId: string, done: (err:any, jobProgress:interf.IJobProgress) => void) => void;
    getJobInfo: (jobId: string, done: (err:any, jobInfo:interf.IJobInfo) => void) => void;
    getJobResult: (jobId: string, done: (err:any, jobResult:interf.IJobResult) => void) => void;
    getDispatcherJSON: (done: (err:any, dispatcherJSON: interf.IDispatcherJSON) => void) => void;
    setDispatchingEnabled: (enabled: boolean, done: (err:any, dispControl: interf.IDispControl) => void) => void; 
    setQueueOpened: (open: boolean, done: (err:any, dispControl: interf.IDispControl) => void) => void;
    getConnections: (done: (err:any, connections: any) => void) => void;
    setNodeEnabled: (nodeId:string, enabled: boolean, done: (err:any, nodeItem: interf.INodeItem) => void) => void;
    logout: (done?:(err:any) => void) => void;
}

export class SessionBase extends ApiCore {
    constructor($drver: rcf.$Driver, access: rcf.OAuth2Access, tokenGrant: rcf.IOAuth2TokenGrant) {
        super($drver, access, tokenGrant);
    }
    createMsgClient() : IMessageClient {
        return this.$M();
    }
    runJob(jobSubmit:interf.IGridJobSubmit) : IGridJob {
        let js = new JobSubmmit(this.$driver, this.access, this.tokenGrant, jobSubmit);
        return new GridJob(this.$driver, this.access, this.tokenGrant, js);
    }
    sumbitJob(jobSubmit:interf.IGridJobSubmit, done: (err:any, jobProgress:interf.IJobProgress) => void) : void {
        let js = new JobSubmmit(this.$driver, this.access, this.tokenGrant, jobSubmit);
        js.submit(done);
    }
    reRunJob(oldJobId:string, failedTasksOnly:boolean) : IGridJob {
        let js = new JobReSubmmit(this.$driver, this.access, this.tokenGrant, oldJobId, failedTasksOnly);
        return new GridJob(this.$driver, this.access, this.tokenGrant, js);
    }
    reSumbitJob(oldJobId:string, failedTasksOnly:boolean, done: (err:any, jobProgress:interf.IJobProgress) => void) : void {
        let js = new JobReSubmmit(this.$driver, this.access, this.tokenGrant, oldJobId, failedTasksOnly);
        js.submit(done);
    }
    getMostRecentJobs(done: (err:any, jobInfos:interf.IJobInfo[]) => void) : void {
        this.$J("GET", '/services/job/most_recent', {}, done);
    }
    killJob(jobId: string, done: (err:any, ret:any) => void) : void {
        let path = Utils.getJobOpPath(jobId, 'kill');
        this.$J("GET", path, {}, done);
    }
    getJobProgress(jobId: string, done: (err:any, jobProgress:interf.IJobProgress) => void) : void {
        let path = Utils.getJobOpPath(jobId, 'progress');
        this.$J("GET", path, {}, done);
    }
    getJobInfo(jobId: string, done: (err:any, jobInfo:interf.IJobInfo) => void) : void {
        let path = Utils.getJobOpPath(jobId, 'info');
        this.$J("GET", path, {}, done);
    }
    getJobResult(jobId: string, done: (err:any, jobResult:interf.IJobResult) => void) : void {
        let path = Utils.getJobOpPath(jobId, 'result');
        this.$J("GET", path, {}, done);
    }
    getDispatcherJSON(done: (err:any, dispatcherJSON: interf.IDispatcherJSON) => void) : void {
        this.$J("GET", '/services/dispatcher', {}, done);
    }
    setDispatchingEnabled(enabled: boolean, done: (err:any, dispControl: interf.IDispControl) => void): void {
        let path = "/services/dispatcher/dispatching/" + (enabled? "start": "stop");
        this.$J("GET", path, {}, done);
    }
    setQueueOpened(open: boolean, done: (err:any, dispControl: interf.IDispControl) => void): void {
        let path = "/services/dispatcher/queue/" + (open? "open": "close");
        this.$J("GET", path, {}, done);
    }
    getConnections(done: (err:any, connections: any) => void) : void {
        this.$J("GET", '/services/connections', {}, done);
    }
    setNodeEnabled(nodeId:string, enabled: boolean, done: (err:any, nodeItem: interf.INodeItem) => void): void {
        let path = Utils.getNodePath(nodeId, (enabled ? "enable": "disable"));
        this.$J("GET", path, {}, done);
    }
}

export {$Driver, OAuth2Access, IOAuth2TokenGrant} from 'rcf';
export {Utils} from  './utils';
export * from './messaging';