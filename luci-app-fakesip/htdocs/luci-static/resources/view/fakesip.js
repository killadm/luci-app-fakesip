'use strict';
'require view';
'require form';
'require fs';
'require rpc';
'require uci';
'require ui';
'require tools.widgets as widgets';

var callServiceList = rpc.declare({
	object: 'service',
	method: 'list',
	params: [ 'name' ],
	expect: { '': {} }
});

var CRON_BEGIN = '# BEGIN fakesip scheduled restart';
var initActionPending = false;

function escapeHTML(value) {
	return String(value == null ? '' : value)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

function getServiceStatus(data) {
	var service = data && data.fakesip;
	var instances = service && service.instances ? service.instances : {};
	var names = Object.keys(instances);
	var pids = [];
	var running = false;

	for (var i = 0; i < names.length; i++) {
		var inst = instances[names[i]];
		if (inst && inst.running) {
			running = true;
			if (inst.pid)
				pids.push(inst.pid);
		}
	}

	return {
		running: running,
		pids: pids
	};
}

function getWeekdayText(value) {
	return ({
		'0': '周日',
		'1': '周一',
		'2': '周二',
		'3': '周三',
		'4': '周四',
		'5': '周五',
		'6': '周六'
	})[value] || '周日';
}

function getScheduleText(crontab) {
	var enabled = uci.get('fakesip', 'main', 'scheduled_restart') === '1';
	var serviceEnabled = uci.get('fakesip', 'main', 'enabled') === '1';
	var mode = uci.get('fakesip', 'main', 'restart_mode') || 'daily';
	var time = uci.get('fakesip', 'main', 'restart_time') || '04:00';
	var weekday = uci.get('fakesip', 'main', 'restart_weekday') || '0';
	var interval = uci.get('fakesip', 'main', 'restart_interval_hours') || '24';
	var active = crontab && crontab.indexOf(CRON_BEGIN) >= 0;
	var text;

	if (!enabled)
		return '未启用';

	if (!serviceEnabled)
		return '服务未启用，计划任务不会生效';

	if (mode === 'weekly')
		text = '每' + getWeekdayText(weekday) + ' ' + time;
	else if (mode === 'interval')
		text = '每 ' + interval + ' 小时';
	else
		text = '每天 ' + time;

	return text + (active ? '（已写入 cron）' : '（等待保存并应用）');
}

function renderRuntimeStatus(enabled, status) {
	if (!enabled && !status.running) {
		return '' +
			'<div class="cbi-value-field">' +
				'<span class="label warning">未启用</span>' +
				'<span style="margin-left:1em">服务当前未运行</span>' +
			'</div>';
	}

	var queue = uci.get('fakesip', 'main', 'queue_num') || '513';
	var ifaceMode = uci.get('fakesip', 'main', 'interface_mode') || 'custom';
	var ifaces = uci.get('fakesip', 'main', 'interfaces') || [];
	var ifaceText = ifaceMode === 'all' ? '全部接口' : (Array.isArray(ifaces) ? ifaces.join(', ') : ifaces);
	var label = status.running ? (enabled ? '运行中' : '运行中（未启用）') : '已停止';
	var labelClass = status.running ? (enabled ? 'label success' : 'label warning') : 'label';
	var pidText = status.pids.length ? 'PID：' + status.pids.join(', ') : 'PID：-';

	return '' +
		'<div class="cbi-value-field">' +
			'<span class="' + labelClass + '">' + label + '</span>' +
			'<span style="margin-left:1em">' + escapeHTML(pidText) + '</span>' +
			'<span style="margin-left:1em">队列：' + escapeHTML(queue) + '</span>' +
			'<span style="margin-left:1em">接口：' + escapeHTML(ifaceText || '-') + '</span>' +
		'</div>';
}

function tailText(text, count) {
	var lines = String(text || '').trim().split(/\r?\n/);

	if (lines.length > count)
		lines = lines.slice(lines.length - count);

	return lines.join('\n') || '暂无 FakeSIP 日志';
}

function renderLogPanel(text, count) {
	return E('pre', {
		'style': 'width:100%;box-sizing:border-box;max-height:32em;overflow:auto;white-space:pre-wrap'
	}, [ tailText(text, count) ]);
}

function renderLogTabs(systemLog, fileLog) {
	var tabs = E('div', { 'style': 'width:100%;box-sizing:border-box' }, [
		E('div', {
			'data-tab': 'file',
			'data-tab-title': '文件日志',
			'data-tab-active': 'true',
			'style': 'width:100%;box-sizing:border-box'
		}, [
			renderLogPanel(fileLog, 200)
		]),
		E('div', {
			'data-tab': 'system',
			'data-tab-title': '系统日志',
			'style': 'width:100%;box-sizing:border-box'
		}, [
			renderLogPanel(systemLog, 200)
		])
	]);

	ui.tabs.initTabGroup(tabs.childNodes);
	return tabs;
}

function validateRange(min, max, message, allowEmpty) {
	return function(sectionId, value) {
		var n;

		if ((value == null || value === '') && allowEmpty)
			return true;

		if (!/^[0-9]+$/.test(value || ''))
			return message;

		n = Number(value);
		if (n < min || n > max)
			return message;

		return true;
	};
}

function validateTime(sectionId, value) {
	if (/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(value || ''))
		return true;

	return '请输入 24 小时制时间，例如 04:00';
}

function validateMark(sectionId, value) {
	var n;

	if (!/^(0x[0-9a-fA-F]+|0|[1-9][0-9]*)$/.test(value || ''))
		return '请输入十进制数或十六进制数，例如 0x10000';

	n = Number(value);
	if (!isFinite(n) || n < 0 || n > 0xffffffff)
		return '数值范围为 0 到 4294967295';

	return true;
}

function validateLogPath(sectionId, value) {
	if (!value)
		return true;

	if (!/^\/(?:var\/log|mnt|opt)\/.+/.test(value) ||
	    /(^|\/)\.\.(\/|$)/.test(value) ||
	    /\/$/.test(value))
		return '日志文件必须是 /var/log、/mnt 或 /opt 下的绝对路径，不能包含 .. 或以 / 结尾';

	return true;
}

function validateOptionalMark(sectionId, value) {
	if (value == null || value === '')
		return true;

	return validateMark(sectionId, value);
}

function runInitAction(action, successText) {
	return fs.exec('/etc/init.d/fakesip', [ action ]).then(function(res) {
		if (res.code !== 0) {
			ui.addNotification('操作失败', E('pre', { 'style': 'white-space:pre-wrap' },
				(res.stderr || res.stdout || '命令执行失败').trim()), 'danger');
			return;
		}

		ui.addNotification(null, E('p', successText), 'info');

		return new Promise(function(resolve) {
			window.setTimeout(function() {
				window.location.reload();
				resolve();
			}, 900);
		});
	}).catch(function(err) {
		ui.addNotification('操作失败', E('pre', { 'style': 'white-space:pre-wrap' },
			String(err && (err.message || err) || 'RPC 调用失败')), 'danger');
	});
}

function renderActionGroup(actions, footer) {
	var buttons = E('div', {
		'style': 'display:flex;gap:.5em;flex-wrap:wrap;align-items:center'
	}, actions.map(function(action) {
		var props = {
			'class': 'cbi-button cbi-button-' + action.style,
			'type': 'button',
			'title': action.title,
			'click': function(ev) {
				var button = ev.currentTarget;

				ev.preventDefault();
				ev.stopPropagation();
				if (action.disabled || initActionPending)
					return false;
				initActionPending = true;
				button.disabled = true;

				return runInitAction(action.action, action.success).then(function(res) {
					initActionPending = false;
					button.disabled = false;
					return res;
				}, function(err) {
					initActionPending = false;
					button.disabled = false;
					throw err;
				});
			}
		};

		if (action.disabled)
			props.disabled = 'disabled';

		return E('button', props, [ action.label || action.title ]);
	}));

	if (!footer)
		return buttons;

	return E('div', {}, [
		buttons,
		E('div', {
			'style': 'margin-top:.5em'
		}, [ footer ])
	]);
}

return view.extend({
	load: function() {
		return uci.load('fakesip').then(function() {
			return Promise.all([
				L.resolveDefault(callServiceList('fakesip'), {}),
				L.resolveDefault(fs.read('/etc/crontabs/root'), ''),
				L.resolveDefault(fs.exec('/usr/libexec/fakesip-logread', [ 'system', '200' ]), { stdout: '' }),
				L.resolveDefault(fs.exec('/usr/libexec/fakesip-logread', [ 'file', '200' ]), { stdout: '' })
			]);
		});
	},

	render: function(data) {
		var services = data[0];
		var serviceEnabled = uci.get('fakesip', 'main', 'enabled') === '1';
		var serviceStatus = getServiceStatus(services);
		var crontab = data[1] || '';
		var logOutput = data[2] && data[2].stdout ? data[2].stdout : '';
		var fileLog = data[3] && data[3].stdout ? data[3].stdout : '';
		var m, s, o, p, enabledOpt, ifaceModeOpt, noHop, payloadTypeOpt;

		m = new form.Map('fakesip', 'FakeSIP');

		s = m.section(form.NamedSection, 'main', 'fakesip');
		s.anonymous = true;
		s.addremove = false;

		s.tab('status', '状态与操作');
		s.tab('basic', '基础设置');
		s.tab('advanced', '高级设置');
		s.tab('schedule', '定时重启');
		s.tab('logs', '日志');

		enabledOpt = s.taboption('status', form.Flag, 'enabled', '启用');
		enabledOpt.rmempty = false;

		o = s.taboption('status', form.DummyValue, '_runtime', '当前状态');
		o.rawhtml = true;
		o.cfgvalue = function() {
			return renderRuntimeStatus(serviceEnabled, serviceStatus);
		};

		o = s.taboption('status', form.DummyValue, '_service_actions', '服务控制');
		o.renderWidget = function() {
			return renderActionGroup([
				{ title: '启动服务', style: 'apply', action: 'start_now', success: 'FakeSIP 已启动', label: '启动', disabled: serviceStatus.running },
				{ title: '停止服务', style: 'reset', action: 'stop_now', success: 'FakeSIP 已停止', label: '停止', disabled: !serviceStatus.running },
				{ title: '重启服务', style: 'reload', action: 'restart_now', success: 'FakeSIP 已重启', label: '重启', disabled: !serviceStatus.running }
			]);
		};

		o = s.taboption('status', form.DummyValue, '_maintenance_actions', '定时任务');
		o.renderWidget = function() {
			return renderActionGroup([
				{ title: '更新定时任务', style: 'apply', action: 'update_cron', success: '定时任务已更新', label: '更新', disabled: !serviceEnabled },
				{ title: '清理残留规则', style: 'remove', action: 'cleanup_rules', success: '残留规则清理完成', label: '清理', disabled: serviceStatus.running }
			], '定时重启：' + getScheduleText(crontab));
		};

		ifaceModeOpt = s.taboption('basic', form.ListValue, 'interface_mode', '接口范围');
		ifaceModeOpt.value('custom', '指定接口');
		ifaceModeOpt.value('all', '全部接口');
		ifaceModeOpt.default = 'custom';
		ifaceModeOpt.rmempty = false;

		o = s.taboption('basic', widgets.NetworkSelect, 'interfaces', '绑定接口');
		o.multiple = true;
		o.rmempty = true;
		o.depends('interface_mode', 'custom');
		o.validate = function(sectionId, value) {
			var selected = Array.isArray(value) ? value.length : String(value || '').trim().length;

			if (enabledOpt.formvalue(sectionId) === '1' &&
			    ifaceModeOpt.formvalue(sectionId) === 'custom' &&
			    !selected)
				return '启用服务时至少选择一个接口';

			return true;
		};

		o = s.taboption('basic', form.ListValue, 'direction', '处理方向');
		o.value('both', '双向');
		o.value('inbound', '入站');
		o.value('outbound', '出站');
		o.default = 'both';
		o.rmempty = false;

		o = s.taboption('basic', form.ListValue, 'ip_family', 'IP 协议');
		o.value('both', 'IPv4 + IPv6');
		o.value('ipv4', '仅 IPv4');
		o.value('ipv6', '仅 IPv6');
		o.default = 'both';
		o.rmempty = false;

		o = s.taboption('advanced', form.Value, 'queue_num', '队列编号');
		o.default = '513';
		o.rmempty = false;
		o.validate = validateRange(1, 4294967295, '请输入 1 到 4294967295 之间的数值', false);

		o = s.taboption('advanced', form.Value, 'fwmark', '绕过标记');
		o.default = '0x10000';
		o.rmempty = false;
		o.validate = validateMark;

		o = s.taboption('advanced', form.Value, 'fwmask', '标记掩码');
		o.placeholder = '留空时使用绕过标记';
		o.rmempty = true;
		o.validate = validateOptionalMark;

		o = s.taboption('advanced', form.Value, 'repeat', '重复包数');
		o.default = '2';
		o.rmempty = false;
		o.validate = validateRange(1, 10, '请输入 1 到 10 之间的数值', false);

		o = s.taboption('advanced', form.Value, 'ttl', '固定 TTL');
		o.default = '3';
		o.rmempty = false;
		o.validate = validateRange(1, 255, '请输入 1 到 255 之间的数值', false);

		noHop = s.taboption('advanced', form.Flag, 'disable_hop_estimation', '禁用跳数估计');
		noHop.rmempty = false;

		o = s.taboption('advanced', form.Value, 'dynamic_pct', '动态 TTL 百分比');
		o.placeholder = '留空表示关闭';
		o.rmempty = true;
		o.validate = function(sectionId, value) {
			var valid = validateRange(1, 99, '请输入 1 到 99 之间的数值', true)(sectionId, value);

			if (valid !== true)
				return valid;

			if (value && noHop.formvalue(sectionId) === '1')
				return '动态 TTL 不能与禁用跳数估计同时启用';

			return true;
		};

		o = s.taboption('advanced', form.Flag, 'skip_firewall', '跳过防火墙规则');
		o.rmempty = false;

		o = s.taboption('advanced', form.Flag, 'use_iptables', '使用 iptables 兼容模式');
		o.rmempty = false;

		o = s.taboption('advanced', form.Value, 'log_file', '日志文件');
		o.default = '/var/log/fakesip/fakesip.log';
		o.placeholder = '/var/log/fakesip/fakesip.log';
		o.rmempty = true;
		o.validate = validateLogPath;

		o = s.taboption('advanced', form.Value, 'log_max_size_kb', '日志轮转大小（KB）');
		o.default = '512';
		o.placeholder = '512';
		o.rmempty = false;
		o.validate = validateRange(64, 16384, '日志轮转大小范围为 64 到 16384 KB', false);

		o = s.taboption('advanced', form.Value, 'log_rotate_count', '日志保留份数');
		o.default = '3';
		o.placeholder = '3';
		o.rmempty = false;
		o.validate = validateRange(1, 10, '日志保留份数范围为 1 到 10', false);

		o = s.taboption('schedule', form.Flag, 'scheduled_restart', '启用定时重启');
		o.rmempty = false;

		o = s.taboption('schedule', form.ListValue, 'restart_mode', '重启模式');
		o.value('daily', '每天');
		o.value('weekly', '每周');
		o.value('interval', '按小时间隔');
		o.default = 'daily';
		o.rmempty = false;
		o.depends('scheduled_restart', '1');

		o = s.taboption('schedule', form.Value, 'restart_time', '重启时间');
		o.default = '04:00';
		o.rmempty = false;
		o.depends({ scheduled_restart: '1', restart_mode: 'daily' });
		o.depends({ scheduled_restart: '1', restart_mode: 'weekly' });
		o.validate = validateTime;

		o = s.taboption('schedule', form.ListValue, 'restart_weekday', '星期');
		o.value('0', '周日');
		o.value('1', '周一');
		o.value('2', '周二');
		o.value('3', '周三');
		o.value('4', '周四');
		o.value('5', '周五');
		o.value('6', '周六');
		o.default = '0';
		o.rmempty = false;
		o.depends({ scheduled_restart: '1', restart_mode: 'weekly' });

		o = s.taboption('schedule', form.Value, 'restart_interval_hours', '间隔小时');
		o.default = '24';
		o.rmempty = false;
		o.depends({ scheduled_restart: '1', restart_mode: 'interval' });
		o.validate = validateRange(1, 168, '请输入 1 到 168 之间的数值', false);

		o = s.taboption('schedule', form.DummyValue, '_schedule_state', '当前计划');
		o.rawhtml = true;
		o.cfgvalue = function() {
			return '<div class="cbi-value-field">' + escapeHTML(getScheduleText(crontab)) + '</div>';
		};

		o = s.taboption('logs', form.Flag, 'silent', '静默模式');
		o.rmempty = false;
		o.description = '启用后仅保留错误等关键输出，减少连接处理明细日志；排查问题时建议关闭。';

		o = s.taboption('logs', form.DummyValue, '_logs');
		o.render = function() {
			return E('div', { 'class': 'cbi-value', 'style': 'display:block' }, [
				E('div', {
					'class': 'cbi-value-field',
					'style': 'display:block;width:100%;margin-left:0'
				}, [
					renderLogTabs(logOutput, fileLog)
				])
			]);
		};

		p = m.section(form.GridSection, 'payload', '负载选项');
		p.anonymous = true;
		p.addremove = true;
		p.sortable = true;
		p.addbtntitle = '添加负载';

		payloadTypeOpt = p.option(form.ListValue, 'type', '类型');
		payloadTypeOpt.value('sip', 'SIP URI');
		payloadTypeOpt.value('custom', '自定义文件');
		payloadTypeOpt.default = 'sip';
		payloadTypeOpt.rmempty = false;

		o = p.option(form.Value, 'value', '值');
		o.placeholder = 'sip:user@example.com 或 /etc/fakesip/payload.bin';
		o.rmempty = true;
		o.validate = function(sectionId, value) {
			var type = payloadTypeOpt.formvalue(sectionId) || 'sip';

			if (type === 'sip') {
				if (!value)
					return true;

				if (value.indexOf('sip:') === 0)
					return true;

				return '请输入以 sip: 开头的 SIP URI';
			}

			if (type === 'custom') {
				if (!value && enabledOpt.formvalue('main') === '1')
					return '请填写自定义文件路径';
				if (!value)
					return true;

				if (value.charAt(0) !== '/')
					return '请输入绝对路径';
			}

			return true;
		};

		return m.render();
	}
});
