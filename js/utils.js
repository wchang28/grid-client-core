// utility functions
var Utils = (function () {
    function Utils() {
    }
    Utils.jobDone = function (jobProgress) {
        return (jobProgress.status === 'FINISHED' || jobProgress.status === 'ABORTED');
    };
    Utils.getDispatcherTopic = function () {
        return '/topic/dispatcher';
    };
    Utils.getJobsTrackingTopic = function () {
        return '/topic/jobs-tracking';
    };
    Utils.getConnectionsTopic = function () {
        return '/topic/connections';
    };
    Utils.getJobNotificationTopic = function (jobId) {
        return '/topic/job/' + jobId;
    };
    Utils.getJobOpPath = function (jobId, op) { return '/services/job/' + jobId + '/' + op; };
    Utils.getNodePath = function (nodeId, op) { return "/services/dispatcher/node/" + nodeId + "/" + op; };
    return Utils;
}());
exports.Utils = Utils;
