/*
config = {
	// sign_url usually link to a app server,
	// and icomet.admin deny all, but allow app server
	sign_url: 'http://...',
	// sub_url link directly to icomet server
	sub_url: 'http://...',
	// be called when receive a msg
	sub_callback: function(msg){}
};
*/
function iComet(config){
	if(iComet.id__ == undefined){
		iComet.id__ = 0;
	}
	
	var self = this;
	self.id = iComet.id__++;
	self.cb = 'icomet_cb_' + self.id;
	self.sub_timeout = 60 * 1000;
	self.timer = null;
	self.sign_timer = null;
	self.stopped = true;
	self.last_sub_time = 0;
	self.need_fast_reconnect = true;

	self.data_seq = 0;
	self.noop_seq = 0;
	self.sign_cb = null;
	
	self.cid = config.cid;
	self.sub_cb = config.sub_callback;
	if(config.sub_url.indexOf('?') == -1){
		self.sub_url = config.sub_url + '?';
	}else{
		self.sub_url = config.sub_url + '&';
	}
	if(config.sign_url.indexOf('?') == -1){
		self.sign_url = config.sign_url + '?';
	}else{
		self.sign_url = config.sign_url + '&';
	}
	self.sub_url += 'cb=' + self.cb;
	self.sign_url += 'cb=' + self.cb;

	window[self.cb] = function(msg, in_batch){
		// batch repsonse
		if(msg instanceof Array){
			self.log('batch response', msg.length);
			for(var i in msg){
				if(msg[i] && msg[i].type == 'data'){
					if(i == msg.length - 1){
						window[self.cb](msg[i]);
					}else{
						window[self.cb](msg[i], true);
					}
				}
			}
			return;
		}
		//self.log('resp', msg);
		if(self.stopped){
			return;
		}
		if(!msg){
			return;
		}
		if(msg.type == '404'){
			self.log('resp', msg);
			// TODO channel id error!
			return;
		}
		if(msg.type == '401'){
			// TODO token error!
			self.log('resp', msg);
			return;
		}
		if(msg.type == '429'){
			// too many connections
			self.log('resp', msg);
			setTimeout(self_sub, 5000 + Math.random() * 5000);
			return;
		}
		if(msg.type == 'sign'){
			self.log('proc', msg);
			if(self.sign_cb){
				self.sign_cb(msg);
			}
			return;
		}
		if(msg.type == 'noop'){
			self.last_sub_time = (new Date()).getTime();
			if(msg.seq == self.noop_seq){
				self.log('proc', msg);
				if(self.noop_seq == 2147483647){
					self.noop_seq = -2147483648;
				}else{
					self.noop_seq ++;
				}
				// if the channel is empty, it is probably empty next time,
				// so pause some seconds before sub again
				setTimeout(self_sub, 2000 + Math.random() * 3000);
			}else{
				self.log('ignore exceeded connections');
			}
			return;
		}
		if(msg.type == 'data'){
			self.last_sub_time = (new Date()).getTime();
			if(msg.seq != self.data_seq){
				if(msg.seq == 0){
					self.log('server restarted');
					// TODO: lost_cb(msg);
					if(self.sub_cb){
						self.sub_cb(msg);
					}
				}else if(msg.seq < self.data_seq){
					self.log('drop', msg);
				}else{
					self.log('msg lost', msg);
					// TODO: lost_cb(msg);
					if(self.sub_cb){
						self.sub_cb(msg);
					}
				}
				
				self.data_seq = msg.seq;
				if(self.data_seq == 2147483647){
					self.data_seq = -2147483648;
				}else{
					self.data_seq ++;
				}
				if(!in_batch){
					// fast reconnect
					var now = new Date().getTime();
					if(self.need_fast_reconnect || now - self.last_sub_time > 3 * 1000){
						self.log('fast reconnect');
						self.need_fast_reconnect = false;
						self_sub();
					}
				}
			}else{
				self.log('proc', msg);
				if(self.data_seq == 2147483647){
					self.data_seq = -2147483648;
				}else{
					self.data_seq ++;
				}
				if(self.sub_cb){
					self.sub_cb(msg);
				}
				if(!in_batch){
					self_sub();
				}
			}
			return;
		}
	}
	
	self.sign = function(callback){
		self.log('sign in icomet server...');
		self.sign_cb = callback;
		var url = self.sign_url + '&_=' + new Date().getTime();
		var script = '\<script class="' + self.cb + '\" src="' + url + '">\<\/script>';
		$('body').append(script);
	}

	var self_sub = function(){
		//self.log('sub');
		self.stopped = false;
		self.last_sub_time = (new Date()).getTime();
		$('script.' + self.cb).remove();
		var url = self.sub_url
			 + '&cid=' + self.cid
			 + '&seq=' + self.data_seq
			 + '&noop=' + self.noop_seq
			 + '&_=' + new Date().getTime();
		var script = '\<script class="' + self.cb + '\" src="' + url + '">\<\/script>';
		setTimeout(function(){
			$('body').append(script);
		}, 0);
	}
	
	self.start = function(){
		self.stopped = false;
		self.sign(function(msg){
			if(self.sign_timer){
				clearTimeout(self.sign_timer);
				self.sign_timer = null;
			}else{
				return;
			}
			if(!self.stopped){
				self.cid = msg.cid;
				try{
					var a = parseInt(msg.sub_timeout) || 0;
					self.sub_timeout = (a + 10) * 1000;
				}catch(e){}
				self.log('start sub ' + self.cid + ', timeout=' + self.sub_timeout + 'ms');
				self._start_timeout_checker();
				self_sub();
			}
		});
		if(!self.sign_timer){
			self.sign_timer = setInterval(self.start, 3000 + Math.random() * 2000);
		}
		if(self.timer){
			clearTimeout(self.timer);
			self.timer = null;
		}
	}

	self.stop = function(){
		self.last_sub_time = 0;
		self.need_fast_reconnect = true;
		self.stopped = true;
		if(self.timer){
			clearTimeout(self.timer);
			self.timer = null;
		}
		if(self.sign_timer){
			clearTimeout(self.sign_timer);
			self.sign_timer = null;
		}
	}
	
	self._start_timeout_checker = function(){
		if(self.timer){
			clearTimeout(self.timer);
		}
		self.timer = setInterval(function(){
			var now = (new Date()).getTime();
			if(now - self.last_sub_time > self.sub_timeout){
				self.log('timeout');
				self.stop();
				self.start();
			}
		}, 1000);
	}
	
	self.log = function(){
		var v = arguments;
		var p = 'icomet[' + self.id + ']';
		var t = new Date().toTimeString().substr(0, 8);
		if(v.length == 1){
			console.log(t, p, v[0]);
		}else if(v.length == 2){
			console.log(t, p, v[0], v[1]);
		}else if(v.length == 3){
			console.log(t, p, v[0], v[1], v[2]);
		}else if(v.length == 4){
			console.log(t, p, v[0], v[1], v[2], v[3]);
		}else if(v.length == 5){
			console.log(t, p, v[0], v[1], v[2], v[3], v[4]);
		}else{
			console.log(t, p, v);
		}
	}

	self.start();

}
