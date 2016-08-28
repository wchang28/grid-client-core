import * as msg from './messaging';

// utility functions
export class Utils {
    static jobDone(jobProgress: msg.IJobProgress) : boolean {
        return (jobProgress.status === 'FINISHED' || jobProgress.status === 'ABORTED');
    }
    static getDispatcherTopic() : string {
        return '/topic/dispatcher';
    }
    static getJobsTrackingTopic() : string {
        return '/topic/jobs-tracking';
    }
    static getConnectionsTopic() : string {
        return '/topic/connections';
    }
    static getJobNotificationTopic(jobId:string) : string {
        return '/topic/job/' + jobId;
    }

    static getJobOpPath(jobId:string, op:string):string {return '/services/job/' + jobId + '/' + op;}
    static getNodePath(nodeId:string, op:string):string {return "/services/dispatcher/node/" + nodeId + "/" +  op;}
}