var define;
if (typeof define === "undefined")
	define = function (classInstance) {
		classInstance (require, exports, module);
	}

define (function (require, exports, module) {

var EventEmitter = require ('events').EventEmitter,
	util         = require ('util'),
	common       = require ('./common'),
	taskClass    = require ('./task/base');

var taskStateNames = taskClass.prototype.stateNames;

var hasOwnProperty = Object.prototype.hasOwnProperty;

function isEmpty(obj) {

    // Assume if it has a length property with a non-zero value
    // that that property is correct.
    if (obj.length && obj.length > 0)    return false;

    for (var key in obj) {
        if (hasOwnProperty.call(obj, key))    return false;
    }

    return true;
}

function checkTaskParams (params, dict, prefix) {
	
	// parse task params
	// TODO: modify this function because recursive changes of parameters works dirty (indexOf for value)
	
	if (prefix == void 0) prefix = '';
	
	var modifiedParams;
	var failedParams = [];
	
	if (params.join) { // params is array
		
		modifiedParams = [];
		
		params.forEach(function (val, index, arr) {
			
			if (val.indexOf || val.interpolate) { // number || string				
				modifiedParams.push(val.interpolate (dict) || val);
			} else {
				var result = checkTaskParams(val, dict, prefix+'['+index+']');
				modifiedParams.push(result.modified);
				failedParams = failedParams.concat (result.failed);
			}
		});
		
	} else { // params is hash
	
		modifiedParams = {};
		
		for (var key in params) {
			var val = params[key];
			var valCheck = val;
			
			if (val.interpolate) { // val is string || number
				
				try {
					
					modifiedParams[key] = val.interpolate (dict) || val;
					if (isEmpty (modifiedParams[key])) throw "EMPTY VALUE";
					
				} catch (e) {
					
					failedParams.push (prefix+'.'+key);
				
				}
				
			} else { // val is hash || array
				
				var result = checkTaskParams(val, dict, prefix+key);
				if (prefix) prefix += '.';
				
				modifiedParams[key] = result.modified;
				failedParams = failedParams.concat (result.failed);
			}		
		}
	}
	
	return {
		modified: modifiedParams,
		failed: failedParams
	};
}

var workflow = module.exports = function (config, reqParam) {
	
	var self = this;
	util.extend (true, this, config);
	util.extend (true, this, reqParam);
	
	this.started = new Date().getTime();
	this.id      = this.id || this.started % 1e6;
	
	if (!this.stage) this.stage = 'process';

	//if (!this.stageMarkers[this.stage])
	//	console.error ('there is no such stage marker: ' + this.stage);

	var idString = ""+this.id;
	while (idString.length < 6) {idString = '0' + idString};
	this.coloredId = [
		"" + idString[0] + idString[1],
		"" + idString[2] + idString[3],
		"" + idString[4] + idString[5]
	].map (function (item) {
		try {
			var _p = process;
			return "\x1B[0;3" + (parseInt(item) % 8)  + "m" + item + "\x1B[0m";
		} catch (e) {
			return item;
		}
		
	}).join ('');

	this.data = this.data || {};
	
//	console.log ('!!!!!!!!!!!!!!!!!!!' + this.data.keys.length);
	
//	console.log ('config, reqParam', config, reqParam);
	
	this.tasks = config.tasks.map (function (taskParams) {
		var task;

		var checkRequirements = function () {
			
			var result = checkTaskParams (taskParams, self);
			
			if (result.failed && result.failed.length > 0) {
				this.unsatisfiedRequirements = result.failed;
				return false;
			} else if (result.modified) {
				util.extend (this, result.modified);
				return true;
			}
		}
		
		//console.log (taskParams);
		
		if (taskParams.className) {
//			self.log (taskParams.className + ': initializing task from class');
			var xTaskClass;
			
			// TODO: need check all task classes, because some compile errors may be there
//			console.log ('task/'+taskParams.className);
			try {
				xTaskClass = require ('task/' + taskParams.className);
			} catch (e) {
				var ee = e;
				try {
					xTaskClass = require ('task-'+taskParams.className);
				} catch (e) {
					console.log ('require task/'+taskParams.className+':', ee);
					console.log ('require task-'+taskParams.className+':', e);
					xTaskClass = require (taskParams.className);
				}
				
			}
			
			task = new xTaskClass ({
				className: taskParams.className,
				method:    taskParams.method,
				require:   checkRequirements
			});
		} else if (taskParams.coderef || taskParams.functionName) {
		
//			self.log ((taskParams.functionName || taskParams.logTitle) + ': initializing task from function');
			if (!taskParams.functionName && !taskParams.logTitle)
				throw "task must have a logTitle when using call parameter";
			
			var xTaskClass = function (config) {
				this.init (config);
			};

			util.inherits (xTaskClass, taskClass);

			util.extend (xTaskClass.prototype, {
				run: function () {
					var failed = false;
					if (taskParams.bind && taskParams.functionName) {
						try {
							var functionRef = taskParams.bind;
							var fSplit = taskParams.functionName.split (".");
							while (fSplit.length) {
								var fChunk = fSplit.shift();
								functionRef = functionRef[fChunk];
							}
							
							this.completed (functionRef.call (taskParams.bind, this));
						} catch (e) {
							failed = 'failed call function "'+taskParams.functionName+'" from ' + taskParams.bind + ' with ' + e;
						}
					} else if (taskParams.functionName) {
						try {
							if (process.mainModule.exports[taskParams.functionName]) {
								this.completed (process.mainModule.exports[taskParams.functionName] (this));
							} else {
								failed = "you defined functionName as " + taskParams.functionName
								+ " but we cannot find this name in current scope.\nplease add 'module.exports = {"
								+ taskParams.functionName + ": function (params) {...}}' in your main module";
							}
						} catch (e) {
							if (window[taskParams.functionName]) {
								this.completed (window[taskParams.functionName] (this));
							} else {
								failed = "you defined functionName as " + taskParams.functionName
								+ " but we cannot find this name in current scope.\nplease add 'window["
								+ taskParams.functionName + "] = function (params) {...}}' in your main module";
							}
						}
					} else {
						// TODO: detailed error description
//						if (taskParams.bind)
						this.completed (taskParams.coderef (this));
					}
					if (failed) throw failed;
				}
			});
			
			task = new xTaskClass ({
				functionName: taskParams.functionName,
				logTitle: taskParams.logTitle,
				require: checkRequirements
			});
			
		}
		
//		console.log (task);
		
		return task;
	});
};

util.inherits (workflow, EventEmitter);

function pad(n) {
	return n < 10 ? '0' + n.toString(10) : n.toString(10);
}

// one second low resolution timer
var currentDate = new Date ();
setInterval (function () {
	currentDate = new Date ();
}, 1000);

function timestamp () {
	var time = [
		pad(currentDate.getHours()),
		pad(currentDate.getMinutes()),
		pad(currentDate.getSeconds())
	].join(':');
	var date = [
		currentDate.getFullYear(),
		pad(currentDate.getMonth() + 1),
		pad(currentDate.getDate())
	].join ('-');
	return [date, time].join(' ');
}


util.extend (workflow.prototype, {
	
	initializeTasks: function () {},
	stageMarker: {prepare: "()", process: "[]", presentation: "<>"},
	isIdle: 1,
	log: function (msg) {
//		if (this.quiet || process.quiet) return;
		var toLog = [
			timestamp (),
			this.stageMarker[this.stage][0] + this.coloredId + this.stageMarker[this.stage][1]
		];
		for (var i = 0, len = arguments.length; i < len; ++i) {
			toLog.push (arguments[i]);
		}
		
		try {if (PhoneGap) {
			toLog.shift();
			toLog = [toLog.join (' ')];
		}} catch (e) {};
		
		console.log.apply (console, toLog);
	},
	logTask: function (task, msg) {
		this.log (task.logTitle,  "("+task.state+")",  msg);
	},
	logTaskError: function (task, msg) {
		// TODO: fix by using console.error
		this.log(task.logTitle, "("+task.state+") \x1B[0;31m" + msg + "\x1B[0m");
	},
	
	haveCompletedTasks: false,
	run: function () {
		
		var self = this;
		
		self.isIdle = 0;
		self.haveCompletedTasks = false;
				
//		self.log ('workflow run');
		
		this.taskStates = [0, 0, 0, 0, 0, 0];
		
		this.tasks.map (function (task) {
			
			if (task.subscribed === void(0)) {
				task.subscribed = 1;
			
				task.on ('log', function (message) {
					self.logTask (task, message); 
				});

				task.on ('warn', function (message) {
					self.logTaskError (task, message); 
				});
				
				task.on ('error', function () {
					self.logTaskError (task, 'error ' + arguments[0]);// + '\n' + arguments[0].stack);
				});
				
				task.on ('cancel', function () {
					
					self.logTaskError (task, 'canceled, retries = ' + task.retries);
					
					if (self.isIdle)
						self.run ();
				});
				
				task.on ('complete', function (t, result) {
					
					if (t.produce && result)
						common.pathToVal (self, t.produce, result);
					
					self.logTask (task, 'task completed');
					
					if (self.isIdle)
						self.run ();
					else
						self.haveCompletedTasks = true;
				});
			}
			
			task.checkState ();
			
			self.taskStates[task.state]++;
			
//			console.log ('task.className, task.state\n', task, task.state, task.isReady ());
			
			if (task.isReady ()) {
				self.logTask (task, 'started');
				task.run ();
			}
		});
		
		var taskStateNames = taskClass.prototype.stateNames;
		
		if (this.taskStates[taskStateNames.ready] || this.taskStates[taskStateNames.running]) {
			// it is save to continue, wait for running/ready task
		} else {
			// here we fail, because no more tasks to complete
		}
		
		self.isIdle = 1;
		
		// check workflow
		
//		if (this.taskStates[taskStateNames.complete] > 0)
//			self.log ('progress: ' + this.taskStates[taskStateNames.complete] + '/'+ self.tasks.length);

//		console.log (
//			'%%%%%%%%%%%%%',
//			this.taskStates[taskStateNames.complete],
//			this.taskStates[taskStateNames.failed],
//			this.taskStates[taskStateNames.scarce],
//			self.tasks.length
//		);

		if (this.taskStates[taskStateNames.complete] == self.tasks.length) {
			
			self.emit ('completed', self);
			self.log ('workflow complete');
		
		} else if (
			this.taskStates[taskStateNames.complete]
			+ this.taskStates[taskStateNames.failed]
			+ this.taskStates[taskStateNames.scarce]
			== self.tasks.length
		) {
			// console.log("taskStateNames.failed -> ", taskStateNames.failed);
			// console.log("taskStateNames.scarce -> ", taskStateNames.scarce);
		
			var scarceTaskMessage = ', unsatisfied requirements: ';
		
			// TODO: display scarce tasks unsatisfied requirements
			if (this.taskStates[taskStateNames.scarce]) {
				self.tasks.map (function (task) {
					if (task.state != taskStateNames.scarce)
						return;
					scarceTaskMessage += (task.logTitle) + ' => ' + task.unsatisfiedRequirements.join (', ') + '; ';
				});
			}
			
			var requestDump = '???';
			try {
				requestDump = JSON.stringify (self.request)
			} catch (e) {
				if ((""+e).match (/circular/))
					requestDump = 'CIRCULAR'
				else
					requestDump = e
			};
			
			self.emit ('failed', self);
			
			self.log ('workflow failed, progress: '
				+ this.taskStates[taskStateNames.complete] + '/'+ self.tasks.length 
				+ ', request: ' /*+ requestDump*/ + scarceTaskMessage
			);

		} else if (self.haveCompletedTasks) {
			
			setTimeout (function () {
				self.run ();
			}, 0);
		
		}
	}
});

});
