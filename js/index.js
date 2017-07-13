"use strict";
var __extends = (this && this.__extends) || (function () {
    var extendStatics = Object.setPrototypeOf ||
        ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
        function (d, b) { for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p]; };
    return function (d, b) {
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
var events = require("events");
var rcf = require("rcf");
var utils_1 = require("./utils");
var eventStreamPathname = '/services/events/event_stream';
var clientOptions = { reconnetIntervalMS: 10000 };
var MessageClient = (function (_super) {
    __extends(MessageClient, _super);
    function MessageClient(__msgClient, topicMountingPath) {
        if (topicMountingPath === void 0) { topicMountingPath = ''; }
        var _this = _super.call(this) || this;
        _this.__msgClient = __msgClient;
        _this.topicMountingPath = topicMountingPath;
        _this.__msgClient.on("ping", function () {
            _this.emit("ping");
        }).on("connect", function (conn_id) {
            _this.emit("connect", conn_id);
        }).on("error", function (err) {
            _this.emit("error", err);
        });
        return _this;
    }
    MessageClient.prototype.subscribe = function (destination, cb, headers) {
        return this.__msgClient.subscribe(this.topicMountingPath + destination, function (msg) {
            var m = msg.body;
            cb(m, msg.headers);
        }, headers);
    };
    MessageClient.prototype.unsubscribe = function (sub_id) { return this.__msgClient.unsubscribe(sub_id); };
    MessageClient.prototype.send = function (destination, headers, msg) { return this.__msgClient.send(this.topicMountingPath + destination, headers, msg); };
    MessageClient.prototype.disconnect = function () { this.__msgClient.disconnect(); };
    return MessageClient;
}(events.EventEmitter));
exports.MessageClient = MessageClient;
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
var ApiCore = (function (_super) {
    __extends(ApiCore, _super);
    function ApiCore($drver, access, __parentAuthApi, topicMountingPath) {
        if (__parentAuthApi === void 0) { __parentAuthApi = null; }
        if (topicMountingPath === void 0) { topicMountingPath = ''; }
        var _this = _super.call(this) || this;
        _this.__parentAuthApi = __parentAuthApi;
        _this.topicMountingPath = topicMountingPath;
        _this.__authApi = new rcf.AuthorizedRestApi($drver, access);
        return _this;
    }
    Object.defineProperty(ApiCore.prototype, "$driver", {
        get: function () { return this.__authApi.$driver; },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(ApiCore.prototype, "access", {
        get: function () { return this.__authApi.access; },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(ApiCore.prototype, "instance_url", {
        get: function () { return this.__authApi.instance_url; },
        enumerable: true,
        configurable: true
    });
    ApiCore.prototype.$J = function (method, pathname, data) {
        var _this = this;
        return new Promise(function (resolve, reject) {
            _this.__authApi.$J(method, pathname, data)
                .then(function (result) {
                resolve(result.data);
            }).catch(function (err) {
                reject(err);
            });
        });
    };
    Object.defineProperty(ApiCore.prototype, "MessageClientFactoryAuthorizedApi", {
        get: function () {
            var IAmAtTop = (this.__parentAuthApi === null);
            return (IAmAtTop ? this.__authApi : this.__parentAuthApi);
        },
        enumerable: true,
        configurable: true
    });
    ApiCore.prototype.$M = function () {
        return new MessageClient(this.MessageClientFactoryAuthorizedApi.$M(eventStreamPathname, clientOptions), this.topicMountingPath);
    };
    ApiCore.prototype.mount = function (mountingPath, topicMountingPath) {
        if (topicMountingPath === void 0) { topicMountingPath = ''; }
        var access = (this.__authApi.access ? JSON.parse(JSON.stringify(this.__authApi.access)) : {});
        access.instance_url = this.__authApi.instance_url + mountingPath;
        return new ApiCore(this.__authApi.$driver, access, this.MessageClientFactoryAuthorizedApi, this.topicMountingPath + topicMountingPath);
    };
    return ApiCore;
}(events.EventEmitter));
exports.ApiCore = ApiCore;
// job submission class
var JobSubmmit = (function (_super) {
    __extends(JobSubmmit, _super);
    function JobSubmmit($drver, access, __jobSubmit) {
        var _this = _super.call(this, $drver, access) || this;
        _this.__jobSubmit = __jobSubmit;
        return _this;
    }
    JobSubmmit.prototype.submit = function () {
        return this.$J('POST', '/services/job/submit', this.__jobSubmit);
    };
    return JobSubmmit;
}(ApiCore));
// job re-submission class
var JobReSubmmit = (function (_super) {
    __extends(JobReSubmmit, _super);
    function JobReSubmmit($drver, access, __oldJobId, __failedTasksOnly) {
        var _this = _super.call(this, $drver, access) || this;
        _this.__oldJobId = __oldJobId;
        _this.__failedTasksOnly = __failedTasksOnly;
        return _this;
    }
    JobReSubmmit.prototype.submit = function () {
        var path = utils_1.Utils.getJobOpPath(this.__oldJobId, 're_submit');
        var data = {
            failedTasksOnly: (this.__failedTasksOnly ? '1' : '0')
        };
        return this.$J('GET', path, data);
    };
    return JobReSubmmit;
}(ApiCore));
;
// will emit the follwoing events:
// 1. submitted (jobId)
// 2. status-changed (jobProgress: IJobProgress)
// 3. done (jobProgress: IJobProgress)
// 4. task-complete (task:ITask)
// 4. error
var GridJob = (function (_super) {
    __extends(GridJob, _super);
    function GridJob($drver, access, __js) {
        var _this = _super.call(this, $drver, access) || this;
        _this.__js = __js;
        _this.__jobId = null;
        return _this;
    }
    GridJob.jobDone = function (jobProgress) {
        return (jobProgress.status === 'FINISHED' || jobProgress.status === 'ABORTED');
    };
    GridJob.prototype.onError = function (msgClient, err) {
        this.emit('error', err);
        if (msgClient)
            msgClient.disconnect();
    };
    // returns true if job is still running, false otherwise
    GridJob.prototype.onJobProgress = function (msgClient, jp) {
        this.emit('status-changed', jp);
        if (utils_1.Utils.jobDone(jp)) {
            if (msgClient)
                msgClient.disconnect();
            this.emit('done', jp);
            return false;
        }
        else
            return true;
    };
    GridJob.prototype.run = function () {
        var _this = this;
        this.__js.submit() // submit the job
            .then(function (jobProgress) {
            // job submit successful
            _this.__jobId = jobProgress.jobId;
            _this.emit('submitted', _this.__jobId);
            if (_this.onJobProgress(null, jobProgress)) {
                // job still running
                var msgClient_1 = _this.$M(); // create a message client
                msgClient_1.on('connect', function (conn_id) {
                    // connected, try to subscribe to the job topic
                    msgClient_1.subscribe(utils_1.Utils.getJobNotificationTopic(_this.jobId), function (gMsg) {
                        if (gMsg.type === 'status-changed') {
                            var jobProgress_1 = gMsg.content;
                            _this.onJobProgress(msgClient_1, jobProgress_1);
                        }
                        else if (gMsg.type === 'task-complete') {
                            var task = gMsg.content;
                            _this.emit('task-complete', task);
                        }
                    }, {})
                        .then(function (sub_id) {
                        // job topic subscription successful, try to get the job progress again
                        var path = utils_1.Utils.getJobOpPath(_this.jobId, 'progress');
                        _this.$J("GET", path, {})
                            .then(function (jobProgress) {
                            _this.onJobProgress(msgClient_1, jobProgress);
                        }).catch(function (err) {
                            _this.onError(msgClient_1, err);
                        });
                    }).catch(function (err) {
                        // job topic subscription failed
                        _this.onError(msgClient_1, err);
                    });
                }).on('error', function (err) {
                    // message client error
                    _this.onError(msgClient_1, err);
                });
            }
        }).catch(function (err) {
            // job submit failed
            _this.onError(null, err);
        });
    };
    Object.defineProperty(GridJob.prototype, "jobId", {
        get: function () { return this.__jobId; },
        enumerable: true,
        configurable: true
    });
    return GridJob;
}(ApiCore));
var AutoScalableGrid = (function () {
    function AutoScalableGrid(api) {
        this.api = api;
    }
    AutoScalableGrid.prototype.getWorkers = function (workerIds) { return this.api.$J("GET", "/get_workers", workerIds); };
    AutoScalableGrid.prototype.requestToTerminateWorkers = function (workerIds) { return this.api.$J("POST", "/request_to_terminate_workers", workerIds); };
    AutoScalableGrid.prototype.setWorkersTerminating = function (workerIds) { return this.api.$J("POST", "/set_workers_terminating", workerIds); };
    AutoScalableGrid.prototype.getCurrentState = function () { return this.api.$J("GET", "/state", {}); };
    return AutoScalableGrid;
}());
var GridAutoScaler = (function () {
    function GridAutoScaler(api) {
        this.api = api;
    }
    GridAutoScaler.prototype.isScalingUp = function () { return this.api.$J("GET", "/is_scaling_up", {}); };
    GridAutoScaler.prototype.launchNewWorkers = function (launchRequest) { return this.api.$J("POST", "/launch_new_workers", launchRequest); };
    GridAutoScaler.prototype.terminateWorkers = function (workers) { return this.api.$J("POST", "/terminate_workers", workers); };
    GridAutoScaler.prototype.terminateLaunchingWorkers = function (workerKeys) { return this.api.$J("POST", "/terminate_launching_workers", workerKeys); };
    GridAutoScaler.prototype.isEnabled = function () { return this.api.$J("GET", "/is_enabled", {}); };
    GridAutoScaler.prototype.enable = function () { return this.api.$J("POST", "/enable", {}); };
    GridAutoScaler.prototype.disable = function () { return this.api.$J("POST", "/disable", {}); };
    GridAutoScaler.prototype.hasMaxWorkersCap = function () { return this.api.$J("GET", "/has_max_workers_cap", {}); };
    GridAutoScaler.prototype.hasMinWorkersCap = function () { return this.api.$J("GET", "/has_min_workers_cap", {}); };
    GridAutoScaler.prototype.getMaxWorkersCap = function () { return this.api.$J("GET", "/get_max_workers_cap", {}); };
    GridAutoScaler.prototype.setMaxWorkersCap = function (value) { return this.api.$J("POST", "/set_max_workers_cap", { value: value }); };
    GridAutoScaler.prototype.getMinWorkersCap = function () { return this.api.$J("GET", "/get_min_workers_cap", {}); };
    GridAutoScaler.prototype.setMinWorkersCap = function (value) { return this.api.$J("POST", "/set_min_workers_cap", { value: value }); };
    GridAutoScaler.prototype.getLaunchingTimeoutMinutes = function () { return this.api.$J("GET", "/get_launching_timeout_minutes", {}); };
    GridAutoScaler.prototype.setLaunchingTimeoutMinutes = function (value) { return this.api.$J("POST", "/set_launching_timeout_minutes", { value: value }); };
    GridAutoScaler.prototype.getTerminateWorkerAfterMinutesIdle = function () { return this.api.$J("GET", "/get_terminate_worker_after_minutes_idle", {}); };
    GridAutoScaler.prototype.setTerminateWorkerAfterMinutesIdle = function (value) { return this.api.$J("POST", "/set_terminate_worker_after_minutes_idle", { value: value }); };
    GridAutoScaler.prototype.getRampUpSpeedRatio = function () { return this.api.$J("GET", "/get_ramp_up_speed_ratio", {}); };
    GridAutoScaler.prototype.setRampUpSpeedRatio = function (value) { return this.api.$J("POST", "/set_ramp_up_speed_ratio", { value: value }); };
    GridAutoScaler.prototype.getLaunchingWorkers = function () { return this.api.$J("GET", "/get_launching_workers", {}); };
    GridAutoScaler.prototype.getJSON = function () { return this.api.$J("GET", "/", {}); };
    GridAutoScaler.prototype.getImplementationInfo = function () { return this.api.$J("GET", "/get_impl_info", {}); };
    return GridAutoScaler;
}());
var SessionBase = (function (_super) {
    __extends(SessionBase, _super);
    function SessionBase($drver, access) {
        return _super.call(this, $drver, access) || this;
    }
    SessionBase.prototype.createMsgClient = function () {
        return this.$M();
    };
    Object.defineProperty(SessionBase.prototype, "AutoScalableGrid", {
        get: function () { return new AutoScalableGrid(this.mount('/services/scalable')); },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(SessionBase.prototype, "GridAutoScaler", {
        get: function () { return new GridAutoScaler(this.mount('/services/autoscaler')); },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(SessionBase.prototype, "AutoScalerImplementationApiCore", {
        get: function () {
            return this.mount(utils_1.Utils.getAutoScalerImplementationApiBasePath(), utils_1.Utils.getAutoScalerImplementationTopic());
        },
        enumerable: true,
        configurable: true
    });
    SessionBase.prototype.getTimes = function () { return this.$J("GET", '/services/times', {}); };
    SessionBase.prototype.autoScalerAvailable = function () { return this.$J("GET", '/services/autoscaler_available', {}); };
    SessionBase.prototype.runJob = function (jobSubmit) {
        var js = new JobSubmmit(this.$driver, this.access, jobSubmit);
        return new GridJob(this.$driver, this.access, js);
    };
    SessionBase.prototype.sumbitJob = function (jobSubmit) {
        var js = new JobSubmmit(this.$driver, this.access, jobSubmit);
        return js.submit();
    };
    SessionBase.prototype.reRunJob = function (oldJobId, failedTasksOnly) {
        var js = new JobReSubmmit(this.$driver, this.access, oldJobId, failedTasksOnly);
        return new GridJob(this.$driver, this.access, js);
    };
    SessionBase.prototype.reSumbitJob = function (oldJobId, failedTasksOnly) {
        var js = new JobReSubmmit(this.$driver, this.access, oldJobId, failedTasksOnly);
        return js.submit();
    };
    SessionBase.prototype.getMostRecentJobs = function () { return this.$J("GET", '/services/job/most_recent', {}); };
    SessionBase.prototype.killJob = function (jobId) {
        var path = utils_1.Utils.getJobOpPath(jobId, 'kill');
        return this.$J("GET", path, {});
    };
    SessionBase.prototype.getJobProgress = function (jobId) {
        var path = utils_1.Utils.getJobOpPath(jobId, 'progress');
        return this.$J("GET", path, {});
    };
    SessionBase.prototype.getJobInfo = function (jobId) {
        var path = utils_1.Utils.getJobOpPath(jobId, 'info');
        return this.$J("GET", path, {});
    };
    SessionBase.prototype.getJobResult = function (jobId) {
        var path = utils_1.Utils.getJobOpPath(jobId, 'result');
        return this.$J("GET", path, {});
    };
    SessionBase.prototype.getDispatcherJSON = function () { return this.$J("GET", '/services/dispatcher', {}); };
    SessionBase.prototype.setDispatchingEnabled = function (enabled) {
        var path = "/services/dispatcher/dispatching/" + (enabled ? "start" : "stop");
        return this.$J("GET", path, {});
    };
    SessionBase.prototype.setQueueOpened = function (open) {
        var path = "/services/dispatcher/queue/" + (open ? "open" : "close");
        return this.$J("GET", path, {});
    };
    SessionBase.prototype.getConnections = function () { return this.$J("GET", '/services/connections', {}); };
    SessionBase.prototype.setNodeEnabled = function (nodeId, enabled) {
        var path = utils_1.Utils.getNodePath(nodeId, (enabled ? "enable" : "disable"));
        return this.$J("GET", path, {});
    };
    SessionBase.prototype.getTaskResult = function (jobId, taskIndex) {
        var path = utils_1.Utils.getTaskOpPath(jobId, taskIndex);
        return this.$J("GET", path, {});
    };
    return SessionBase;
}(ApiCore));
exports.SessionBase = SessionBase;
var utils_2 = require("./utils");
exports.Utils = utils_2.Utils;
