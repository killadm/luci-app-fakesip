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
var updateActionPending = false;
var runtimeStatusId = 'fakesip-runtime-status';
var serviceActionsId = 'fakesip-service-actions';
var maintenanceActionsId = 'fakesip-maintenance-actions';
var scheduleStateId = 'fakesip-schedule-state';
var updatePanelId = 'fakesip-update-panel';
var updateHelper = '/usr/libexec/fakesip-update';
var updatePollInterval = 1500;
var stylesheetId = 'fakesip-view-stylesheet';

function loadStylesheet() {
	var href = L.resource('view/fakesip.css');
	var link = document.getElementById(stylesheetId);

	if (link) {
		if (link.getAttribute('href') !== href)
			link.setAttribute('href', href);
		return;
	}

	link = document.createElement('link');
	link.id = stylesheetId;
	link.rel = 'stylesheet';
	link.href = href;
	document.head.appendChild(link);
}

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
			'<div id="' + runtimeStatusId + '" class="cbi-value-field">' +
				'<span class="label warning">未启用</span>' +
				'<span class="fakesip-status-meta">服务当前未运行</span>' +
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
		'<div id="' + runtimeStatusId + '" class="cbi-value-field">' +
			'<span class="' + labelClass + '">' + label + '</span>' +
			'<span class="fakesip-status-meta">' + escapeHTML(pidText) + '</span>' +
			'<span class="fakesip-status-meta">队列：' + escapeHTML(queue) + '</span>' +
			'<span class="fakesip-status-meta">接口：' + escapeHTML(ifaceText || '-') + '</span>' +
		'</div>';
}

function renderScheduleState(crontab) {
	return '<div id="' + scheduleStateId + '" class="cbi-value-field">' + escapeHTML(getScheduleText(crontab)) + '</div>';
}

function asBool(value) {
	return value === true || value === 1 || value === '1';
}

function getPackageInfo(updateInfo, key) {
	var packages = updateInfo && updateInfo.packages ? updateInfo.packages : {};

	return packages[key] || {};
}

function formatValue(value) {
	return value == null || value === '' ? '-' : String(value);
}

function formatPackageVersion(pkg) {
	if (!asBool(pkg.installed))
		return '未安装';

	return formatValue(pkg.version);
}

function getCurrentVersionText(updateInfo) {
	var fakesipPkg = getPackageInfo(updateInfo, 'fakesip');
	var luciPkg = getPackageInfo(updateInfo, 'luci');
	var fakesipVersion = formatPackageVersion(fakesipPkg);
	var luciVersion = formatPackageVersion(luciPkg);

	if (fakesipVersion === luciVersion)
		return fakesipVersion;

	return '服务 ' + fakesipVersion + ' / LuCI ' + luciVersion;
}

function getSystemText(updateInfo) {
	var system = updateInfo && updateInfo.system ? updateInfo.system : {};
	var distro = formatValue(system.distro_name) + (system.release ? ' ' + system.release : '');
	var parts = [ distro ];

	if (system.target)
		parts.push(system.target);

	if (system.package_format)
		parts.push(system.package_format);

	return parts.join(' / ');
}

function parseUpdateResult(res, command, fallbackMessage) {
	var data = null;

	try {
		data = JSON.parse((res && res.stdout) || '{}');
	} catch (e) {
		data = null;
	}

	if (!data || typeof data !== 'object')
		data = {};

	if (data.ok == null)
		data.ok = !res || res.code === 0;

	if (!data.command)
		data.command = command;

	if (!data.message)
		data.message = String((res && (res.stderr || res.stdout || res.message)) || fallbackMessage || '命令执行失败').trim();

	return data;
}

function execUpdateHelper(command) {
	return fs.exec(updateHelper, [ command ]).then(function(res) {
		return parseUpdateResult(res, command);
	}).catch(function(err) {
		return parseUpdateResult(err, command, String(err && (err.message || err) || 'RPC 调用失败'));
	});
}

function getProgressPayload(data) {
	return data && data.progress && typeof data.progress === 'object' ? data.progress : {};
}

function getInitialProgressPayload(data) {
	var progress = getProgressPayload(data);

	if (!isUpdateProgressRunning(progress) && progress.stage === 'finished' && asBool(progress.ok))
		return {};

	return progress;
}

function isUpdateProgressRunning(progress) {
	return asBool(progress && progress.running);
}

function hasUpdateProgress(progress) {
	return !!(progress && (isUpdateProgressRunning(progress) || progress.stage || progress.message || progress.log));
}

function getProgressStageText(stage) {
	return ({
		'starting': '准备中',
		'checking': '检查更新',
		'downloading': '下载中',
		'verifying': '校验中',
		'stopping': '停止服务',
		'installing': '安装中',
		'restarting': '恢复服务',
		'finished': '已完成',
		'failed': '已失败',
		'idle': '未运行'
	})[stage] || '处理中';
}

function stopUpdatePolling(viewObj) {
	if (viewObj.updatePollTimer) {
		window.clearTimeout(viewObj.updatePollTimer);
		viewObj.updatePollTimer = null;
	}
}

function scheduleUpdatePoll(viewObj) {
	stopUpdatePolling(viewObj);
	viewObj.updatePollTimer = window.setTimeout(function() {
		pollUpdateProgress(viewObj);
	}, updatePollInterval);
}

function notifyFinishedProgress(progress) {
	notifyUpdateResult({
		ok: asBool(progress && progress.ok),
		message: (progress && progress.message) || (asBool(progress && progress.ok) ? '在线更新完成' : '在线更新失败'),
		log: progress && progress.log
	}, 'install');
}

function refreshUpdateInfoAfterInstall(viewObj) {
	return execUpdateHelper('check').then(function(data) {
		replaceUpdatePanel(viewObj, data);
	}, function() {
		replaceUpdatePanel(viewObj, viewObj.updateInfo);
	});
}

function handleUpdatePollFailure(viewObj, message) {
	viewObj.updatePollFailures = (viewObj.updatePollFailures || 0) + 1;

	if (viewObj.updatePollFailures <= 3) {
		scheduleUpdatePoll(viewObj);
		return;
	}

	updateActionPending = false;
	viewObj.updateProgressActive = false;
	stopUpdatePolling(viewObj);
	replaceUpdatePanel(viewObj, viewObj.updateInfo);
	notifyUpdateResult({
		ok: false,
		message: message || '读取升级进度失败'
	}, 'install');
}

function pollUpdateProgress(viewObj) {
	return execUpdateHelper('progress').then(function(data) {
		var progress = getProgressPayload(data);
		var running = isUpdateProgressRunning(progress);

		if (!asBool(data.ok) && !data.progress)
			return handleUpdatePollFailure(viewObj, data.message);

		viewObj.updatePollFailures = 0;
		viewObj.updateProgress = progress;
		updateActionPending = running;
		replaceUpdatePanel(viewObj, viewObj.updateInfo);

		if (running) {
			scheduleUpdatePoll(viewObj);
			return;
		}

		stopUpdatePolling(viewObj);
		if (viewObj.updateProgressActive) {
			viewObj.updateProgressActive = false;
			notifyFinishedProgress(progress);

			if (asBool(progress.ok))
				return refreshUpdateInfoAfterInstall(viewObj);
		}
	}, function(err) {
		return handleUpdatePollFailure(viewObj, String(err && (err.message || err) || '读取升级进度失败'));
	});
}

function startUpdatePolling(viewObj) {
	viewObj.updateProgressActive = true;
	viewObj.updatePollFailures = 0;
	updateActionPending = true;
	replaceUpdatePanel(viewObj, viewObj.updateInfo);
	return pollUpdateProgress(viewObj);
}

function recoverStartedUpdate(viewObj, fallbackData) {
	return execUpdateHelper('progress').then(function(progressData) {
		var progress = getProgressPayload(progressData);

		viewObj.updateProgress = progress;
		if (isUpdateProgressRunning(progress) || hasUpdateProgress(progress))
			return startUpdatePolling(viewObj);

		updateActionPending = false;
		replaceUpdatePanel(viewObj, viewObj.updateInfo);
		notifyUpdateResult(fallbackData, 'install');
	}, function() {
		updateActionPending = false;
		replaceUpdatePanel(viewObj, viewObj.updateInfo);
		notifyUpdateResult(fallbackData, 'install');
	});
}

function isRequestTimeoutMessage(message) {
	return /timeout|timed out/i.test(String(message || ''));
}

function getUpdateStateLabel(updateInfo) {
	var latest = updateInfo && updateInfo.latest ? updateInfo.latest : {};

	if (!asBool(latest.checked))
		return { text: '检查更新', cls: 'cbi-button cbi-button-reload' };

	if (!asBool(updateInfo.ok))
		return { text: '检查失败', cls: 'cbi-button cbi-button-reload' };

	if (!asBool(latest.release_available) && !latest.release_tag)
		return { text: '暂无发布', cls: 'cbi-button cbi-button-reload' };

	if (!asBool(latest.supported))
		return { text: '不支持', cls: 'cbi-button cbi-button-reload' };

	if (asBool(latest.update_available))
		return { text: '可更新', cls: 'cbi-button cbi-button-apply' };

	return { text: '已是最新', cls: 'cbi-button' };
}

function renderReleaseValue(latest) {
	var tag = latest && latest.release_tag ? latest.release_tag : '-';

	if (latest && /^https?:\/\//.test(latest.release_url))
		return E('a', {
			'href': latest.release_url,
			'target': '_blank',
			'rel': 'noopener noreferrer'
		}, [ tag ]);

	return E('span', { 'class': 'fakesip-mono' }, [ tag ]);
}

function showFakesipModal(title, children) {
	var args = [ title, children ];

	for (var i = 2; i < arguments.length; i++) {
		var classes = String(arguments[i] || '').trim().split(/\s+/);

		for (var j = 0; j < classes.length; j++)
			if (classes[j])
				args.push(classes[j]);
	}

	return ui.showModal.apply(ui, args);
}

function confirmInstallUpdate(updateInfo) {
	var latest = updateInfo && updateInfo.latest ? updateInfo.latest : {};
	var version = latest.package_version || '最新版本';

	return new Promise(function(resolve) {
		showFakesipModal('确认在线更新', [
			E('div', { 'class': 'fakesip-update-confirm' }, [
				E('p', {}, [
					'将从 GitHub Release 下载与当前系统完全匹配的 FakeSIP 安装包，并调用系统包管理器安装至 ',
					E('strong', {}, [ version ]),
					'。'
				]),
				E('p', {}, [
					'安装前会校验 sha256；如果服务正在运行，会先停止并在安装完成后恢复运行。'
				]),
				E('div', { 'class': 'button-row' }, [
					E('button', {
						'class': 'btn cbi-button',
						'type': 'button',
						'click': function() {
							resolve(false);
							ui.hideModal();
						}
					}, [ '取消' ]), ' ',
					E('button', {
						'class': 'btn cbi-button cbi-button-apply important',
						'type': 'button',
						'click': function() {
							resolve(true);
							ui.hideModal();
						}
					}, [ '确认更新' ])
				])
			])
		], 'cbi-modal', 'fakesip-update-confirm-modal');
	});
}

function addUpdateNotification(title, body, type) {
	var node = ui.addNotification(title, body, type);
	var button = node ? node.querySelector('button') : null;

	if (button) {
		button.addEventListener('click', function(ev) {
			ev.preventDefault();
			if (ev.stopImmediatePropagation)
				ev.stopImmediatePropagation();
			else
				ev.stopPropagation();

			if (node.parentNode)
				node.parentNode.removeChild(node);
		}, true);
	}

	return node;
}

function notifyUpdateResult(data, command) {
	var title = data.ok ? null : (command === 'check' ? '检查更新失败' : '在线更新失败');
	var type = data.ok ? 'info' : 'danger';
	var body = [ E('p', {}, [ data.message || '操作完成' ]) ];

	if (data.log)
		body.push(E('pre', { 'class': 'fakesip-notification-log' }, [
			command === 'install' ? tailTextNewestFirst(data.log, 80) : tailText(data.log, 80)
		]));

	if (command === 'check' && data.ok && data.latest && !asBool(data.latest.supported))
		type = 'warning';

	addUpdateNotification(title, body, type);
}

function replaceUpdatePanel(viewObj, updateInfo) {
	var oldPanel = document.getElementById(updatePanelId);
	var newPanel;

	viewObj.updateInfo = updateInfo;

	if (!oldPanel || !oldPanel.parentNode)
		return;

	newPanel = renderUpdatePanel(viewObj);
	oldPanel.parentNode.replaceChild(newPanel, oldPanel);
}

function runUpdateCommand(viewObj, command) {
	var start = command === 'install' ? confirmInstallUpdate(viewObj.updateInfo) : Promise.resolve(true);

	return start.then(function(confirmed) {
		if (!confirmed || updateActionPending)
			return false;

		updateActionPending = true;
		replaceUpdatePanel(viewObj, viewObj.updateInfo);

		if (command === 'install') {
			return execUpdateHelper('install-start').then(function(data) {
				var progress = getProgressPayload(data);

				viewObj.updateProgress = progress;
				if (!asBool(data.ok) && !isUpdateProgressRunning(progress)) {
					if (hasUpdateProgress(progress))
						return startUpdatePolling(viewObj);

					if (isRequestTimeoutMessage(data.message))
						return recoverStartedUpdate(viewObj, data);

					updateActionPending = false;
					replaceUpdatePanel(viewObj, viewObj.updateInfo);
					notifyUpdateResult(data, command);
					return;
				}

				return startUpdatePolling(viewObj);
			}, function(err) {
				var data = {
					ok: false,
					command: command,
					message: String(err && (err.message || err) || 'RPC 调用失败')
				};

				updateActionPending = false;
				replaceUpdatePanel(viewObj, viewObj.updateInfo);
				notifyUpdateResult(data, command);
			});
		}

		return execUpdateHelper(command).then(function(data) {
			updateActionPending = false;
			replaceUpdatePanel(viewObj, data);
			notifyUpdateResult(data, command);
		}, function(err) {
			var data = {
				ok: false,
				command: command,
				message: String(err && (err.message || err) || 'RPC 调用失败')
			};

			updateActionPending = false;
			replaceUpdatePanel(viewObj, data);
			notifyUpdateResult(data, command);
		});
	});
}

function renderUpdateProgress(progress) {
	var running = isUpdateProgressRunning(progress);
	var stage = progress && progress.stage ? progress.stage : 'idle';
	var message = progress && progress.message ? progress.message : '';
	var log = progress && progress.log ? progress.log : '';
	var labelClass = running ? 'label warning' : (asBool(progress && progress.ok) ? 'label success' : 'label warning');

	if (!hasUpdateProgress(progress) || (stage === 'idle' && !message && !log))
		return null;

	return E('div', { 'class': 'fakesip-update-progress' }, [
		E('div', { 'class': 'fakesip-update-progress-head' }, [
			E('span', { 'class': labelClass }, [ getProgressStageText(stage) ]),
			message ? E('span', { 'class': 'fakesip-update-status-text' }, [ message ]) : null
		].filter(function(el) { return el != null; })),
		log ? E('pre', { 'class': 'fakesip-update-log' }, [ tailTextNewestFirst(log, 120, '暂无升级日志') ]) : null
	].filter(function(el) { return el != null; }));
}

function renderUpdatePanel(viewObj) {
	var updateInfo = viewObj.updateInfo || {};
	var progress = viewObj.updateProgress || {};
	var latest = updateInfo.latest || {};
	var state = getUpdateStateLabel(updateInfo);
	var checked = asBool(latest.checked);
	var isUpdateAvailable = checked && asBool(latest.supported) && asBool(latest.update_available);
	var latestVersion = latest.package_version || (checked ? '-' : '未检查');
	var progressRunning = isUpdateProgressRunning(progress);
	var showProgress = progressRunning || viewObj.updateProgressActive ||
		(progress && (progress.stage === 'finished' || progress.stage === 'failed'));
	var msg = progressRunning ? '' : (checked ? (latest.reason || (updateInfo && updateInfo.message) || '') : '');
	var metaChildren = [ getSystemText(updateInfo) ];
	var btnText, btnAction, btnClass, btnTitle, btnDisabled;

	if (updateActionPending || progressRunning) {
		btnText = progressRunning ? '升级中' : '处理中';
		btnAction = null;
		btnClass = 'cbi-button cbi-button-reload';
		btnTitle = '';
		btnDisabled = 'disabled';
	} else if (isUpdateAvailable) {
		btnText = '更新到 ' + (latest.package_version || '最新版本');
		btnAction = 'install';
		btnClass = 'cbi-button cbi-button-apply';
		btnTitle = '下载并安装匹配当前系统的发布包';
		btnDisabled = null;
	} else {
		btnText = state.text;
		btnAction = 'check';
		btnClass = state.cls;
		btnTitle = checked ? '重新检查更新' : '从 GitHub Release 检查最新版本';
		btnDisabled = null;
	}

	if (latest.release_tag)
		metaChildren.push(' / Release ', renderReleaseValue(latest));

	var btnProps = {
		'class': btnClass,
		'type': 'button',
		'title': btnTitle,
		'click': function(ev) {
			ev.preventDefault();
			ev.stopPropagation();
			if (btnAction)
				return runUpdateCommand(viewObj, btnAction);
			return false;
		}
	};

	if (btnDisabled)
		btnProps.disabled = btnDisabled;

	return E('div', { 'id': updatePanelId, 'class': 'fakesip-update-panel' }, [
		E('div', { 'class': 'fakesip-update-brief-item' }, [
			E('span', { 'class': 'fakesip-update-brief-label' }, [ '当前版本' ]),
			E('span', { 'class': 'fakesip-mono' }, [ getCurrentVersionText(updateInfo) ])
		]),
		E('div', { 'class': 'fakesip-update-brief-item' }, [
			E('span', { 'class': 'fakesip-update-brief-label' }, [ '最新版本' ]),
			E('span', { 'class': 'fakesip-mono' }, [ latestVersion ])
		]),
		E('div', { 'class': 'cbi-value-description fakesip-update-meta' }, metaChildren),
		E('div', { 'class': 'fakesip-action-group fakesip-update-actions' }, [
			E('button', btnProps, [ btnText ]),
			msg ? E('span', { 'class': 'fakesip-update-status-text' }, [ msg ]) : null
		].filter(function(el) { return el != null; })),
		showProgress ? renderUpdateProgress(progress) : null
	].filter(function(el) { return el != null; }));
}

function tailText(text, count, fallback) {
	var lines = String(text || '').trim().split(/\r?\n/);

	if (lines.length > count)
		lines = lines.slice(lines.length - count);

	return lines.join('\n') || fallback || '暂无 FakeSIP 日志';
}

function tailTextNewestFirst(text, count, fallback) {
	var lines = String(text || '').trim().split(/\r?\n/);

	if (lines.length > count)
		lines = lines.slice(lines.length - count);

	return lines.reverse().join('\n') || fallback || '暂无 FakeSIP 日志';
}

function renderLogPanel(text, count) {
	return E('pre', {
		'class': 'fakesip-log-panel'
	}, [ tailText(text, count) ]);
}

function renderLogTabs(systemLog, fileLog) {
	var tabs = E('div', { 'class': 'fakesip-log-tabs' }, [
		E('div', {
			'data-tab': 'file',
			'data-tab-title': '文件日志',
			'data-tab-active': 'true'
		}, [
			renderLogPanel(fileLog, 200)
		]),
		E('div', {
			'data-tab': 'system',
			'data-tab-title': '系统日志'
		}, [
			renderLogPanel(systemLog, 200)
		])
	]);
	var wrapper = E('div', { 'class': 'fakesip-log-tabs-wrap' }, [ tabs ]);

	ui.tabs.initTabGroup(tabs.childNodes);
	return wrapper;
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

function validateLogMaxSize(sectionId, value) {
	if (!/^[0-9]+[KkMmGg]?$/.test(value || ''))
		return '请输入纯数字字节数，或带 K、M、G 后缀的大小；0 表示关闭内置轮转';

	return true;
}

function renderFilterOrderHelp() {
	return E('div', { 'class': 'fakesip-filter-help' }, [
		E('ul', {}, [
			E('li', {}, [ '只有黑名单：默认都处理，命中 ', E('code', {}, [ 'deny' ]), ' 的不处理。' ]),
			E('li', {}, [ '只有 IP/端口 白名单：只处理源 IP/端口 或目的 IP/端口 命中的流量。' ]),
			E('li', {}, [ '同时有 IP 白名单和端口白名单：必须 IP 命中且端口命中才处理。' ]),
			E('li', {}, [ '同时命中 ', E('code', {}, [ 'allow' ]), ' 和 ', E('code', {}, [ 'deny' ]), '：按 ', E('code', {}, [ 'deny' ]), ' 处理，不生成 FakeSIP 混淆包。' ])
		])
	]);
}

function confirmSilentDisabledSave() {
	return new Promise(function(resolve) {
		showFakesipModal('确认关闭静默模式', [
			E('p', {}, [ '关闭静默模式会逐包输出日志，可能快速增加日志量。除排查问题时外，日常使用建议开启。' ]),
			E('div', { 'class': 'button-row' }, [
				E('button', {
					'class': 'btn cbi-button',
					'type': 'button',
					'click': function() {
						resolve(false);
						ui.hideModal();
					}
				}, [ '取消' ]), ' ',
				E('button', {
					'class': 'btn cbi-button cbi-button-negative important',
					'type': 'button',
					'click': function() {
						resolve(true);
						ui.hideModal();
					}
				}, [ '确认保存' ])
			])
		], 'cbi-modal');
	});
}

function isValidIPv4(value) {
	var parts = String(value || '').split('.');

	if (parts.length !== 4)
		return false;

	for (var i = 0; i < parts.length; i++) {
		if (!/^(0|[1-9][0-9]{0,2})$/.test(parts[i]))
			return false;
		if (Number(parts[i]) > 255)
			return false;
	}

	return true;
}

function isValidIPv6(value) {
	if (String(value || '').indexOf(':') < 0)
		return false;

	try {
		return new URL('http://[' + value + ']/').hostname.length > 0;
	} catch (e) {
		return false;
	}
}

function validateFilterIpValue(value) {
	var parts = String(value || '').split('/');
	var addr = parts[0];
	var prefix;

	if (parts.length > 2 || !addr)
		return false;

	if (parts.length === 2) {
		prefix = Number(parts[1]);
		if (!/^[0-9]+$/.test(parts[1]))
			return false;
	}

	if (isValidIPv4(addr))
		return parts.length === 1 || (prefix >= 0 && prefix <= 32);

	if (isValidIPv6(addr))
		return parts.length === 1 || (prefix >= 0 && prefix <= 128);

	return false;
}

function validateFilterPortValue(value) {
	var parts = String(value || '').split('-');
	var start, end;

	if (parts.length > 2 || !/^[0-9]+$/.test(parts[0] || ''))
		return false;

	start = Number(parts[0]);
	end = parts.length === 2 ? Number(parts[1]) : start;

	if (parts.length === 2 && !/^[0-9]+$/.test(parts[1] || ''))
		return false;

	return start >= 1 && start <= 65535 && end >= 1 && end <= 65535 && start <= end;
}

function getSiblingOption(section, optionName) {
	var children = section && section.children ? section.children : [];

	for (var i = 0; i < children.length; i++) {
		if (children[i].option === optionName)
			return children[i];
	}

	return null;
}

function getSiblingFormValue(currentOpt, fallbackOpt, sectionId, optionName) {
	var opt = getSiblingOption(currentOpt && currentOpt.section, optionName) || fallbackOpt;

	return opt ? opt.formvalue(sectionId) : null;
}

function revalidateSiblingOption(currentOpt, sectionId, optionName) {
	var opt = getSiblingOption(currentOpt && currentOpt.section, optionName);

	if (opt)
		opt.isValid(sectionId);
}

function validateFilterValue(typeOpt) {
	return function(sectionId, value) {
		var type = getSiblingFormValue(this, typeOpt, sectionId, 'type') || 'ip';

		if (!value)
			return '请填写匹配值';

		if (/[\s#]/.test(value) || !/^[A-Za-z0-9:./-]+$/.test(value))
			return '匹配值不能包含空白、# 或特殊字符';

		if (type === 'ip' && !validateFilterIpValue(value))
			return '请输入有效的 IPv4、IPv6 或 CIDR';

		if (type === 'port' && !validateFilterPortValue(value))
			return '请输入 1-65535 的端口或端口范围';

		return true;
	};
}

function validateOptionalMark(sectionId, value) {
	if (value == null || value === '')
		return true;

	return validateMark(sectionId, value);
}

function replaceElementById(id, newNode) {
	var oldNode = document.getElementById(id);

	if (!oldNode || !oldNode.parentNode || !newNode)
		return false;

	oldNode.parentNode.replaceChild(newNode, oldNode);
	return true;
}

function htmlToNode(html) {
	var wrapper = document.createElement('div');

	wrapper.innerHTML = html;
	return wrapper.firstElementChild;
}

function replaceHtmlElement(id, html) {
	return replaceElementById(id, htmlToNode(html));
}

function refreshInlineStatus(viewObj) {
	return Promise.all([
		L.resolveDefault(callServiceList('fakesip'), {}),
		L.resolveDefault(fs.read('/etc/crontabs/root'), '')
	]).then(function(data) {
		var serviceEnabled = uci.get('fakesip', 'main', 'enabled') === '1';
		var serviceStatus = getServiceStatus(data[0]);
		var crontab = data[1] || '';

		if (viewObj) {
			viewObj.serviceEnabled = serviceEnabled;
			viewObj.serviceStatus = serviceStatus;
			viewObj.crontab = crontab;
		}

		replaceHtmlElement(runtimeStatusId, renderRuntimeStatus(serviceEnabled, serviceStatus));
		replaceElementById(serviceActionsId, renderServiceActions(serviceStatus, viewObj));
		replaceElementById(maintenanceActionsId, renderMaintenanceActions(serviceEnabled, serviceStatus, crontab, viewObj));
		replaceHtmlElement(scheduleStateId, renderScheduleState(crontab));
	});
}

function delay(ms) {
	return new Promise(function(resolve) {
		window.setTimeout(resolve, ms);
	});
}

function renderServiceActions(serviceStatus, viewObj) {
	return renderActionGroup([
		{ title: '启动服务', style: 'apply', action: 'start_now', success: 'FakeSIP 已启动', label: '启动', disabled: serviceStatus.running },
		{ title: '停止服务', style: 'reset', action: 'stop_now', success: 'FakeSIP 已停止', label: '停止', disabled: !serviceStatus.running },
		{ title: '重启服务', style: 'reload', action: 'restart_now', success: 'FakeSIP 已重启', label: '重启', disabled: !serviceStatus.running }
	], null, serviceActionsId, viewObj);
}

function renderMaintenanceActions(serviceEnabled, serviceStatus, crontab, viewObj) {
	return renderActionGroup([
		{ title: '更新定时任务', style: 'apply', action: 'update_cron', success: '定时任务已更新', label: '更新', disabled: !serviceEnabled },
		{ title: '清理残留规则', style: 'remove', action: 'cleanup_rules', success: '残留规则清理完成', label: '清理', disabled: serviceStatus.running }
	], '定时重启：' + getScheduleText(crontab), maintenanceActionsId, viewObj);
}

function runInitAction(action, successText, viewObj) {
	return fs.exec('/etc/init.d/fakesip', [ action ]).then(function(res) {
		if (res.code !== 0) {
			ui.addNotification('操作失败', E('pre', { 'class': 'fakesip-notification-log' },
				(res.stderr || res.stdout || '命令执行失败').trim()), 'danger');
			return;
		}

		ui.addNotification(null, E('p', successText), 'info');

		return delay(700).then(function() {
			return refreshInlineStatus(viewObj).catch(function(err) {
				ui.addNotification('状态刷新失败', E('pre', { 'class': 'fakesip-notification-log' },
					String(err && (err.message || err) || 'RPC 调用失败')), 'warning');
			});
		});
	}).catch(function(err) {
		ui.addNotification('操作失败', E('pre', { 'class': 'fakesip-notification-log' },
			String(err && (err.message || err) || 'RPC 调用失败')), 'danger');
	});
}

function renderActionGroup(actions, footer, id, viewObj) {
	var groupProps = {};
	var buttons = E('div', {
		'class': 'fakesip-action-group'
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

				return runInitAction(action.action, action.success, viewObj).then(function(res) {
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

	if (!footer) {
		if (id)
			buttons.id = id;
		return buttons;
	}

	if (id)
		groupProps.id = id;

	return E('div', groupProps, [
		buttons,
		E('div', {
			'class': 'fakesip-action-footer'
		}, [ footer ])
	]);
}

return view.extend({
	map: null,
	silentOpt: null,
	serviceEnabled: false,
	serviceStatus: null,
	crontab: '',
	updateInfo: null,
	updateProgress: null,
	updateProgressActive: false,
	updatePollTimer: null,
	updatePollFailures: 0,

	load: function() {
		loadStylesheet();

		return uci.load('fakesip').then(function() {
			return Promise.all([
				L.resolveDefault(callServiceList('fakesip'), {}),
				L.resolveDefault(fs.read('/etc/crontabs/root'), ''),
				L.resolveDefault(fs.exec('/usr/libexec/fakesip-logread', [ 'system', '200' ]), { stdout: '' }),
				L.resolveDefault(fs.exec('/usr/libexec/fakesip-logread', [ 'file', '200' ]), { stdout: '' }),
				L.resolveDefault(fs.exec(updateHelper, [ 'status' ]), { stdout: '' }),
				L.resolveDefault(fs.exec(updateHelper, [ 'progress' ]), { stdout: '' })
			]);
		});
	},

	confirmSave: function() {
		if (!this.silentOpt || this.silentOpt.formvalue('main') === '1')
			return Promise.resolve(true);

		return confirmSilentDisabledSave();
	},

	handleSave: function(ev) {
		return this.confirmSave().then(L.bind(function(confirmed) {
			if (!confirmed)
				return false;

			if (!this.map)
				return false;

			return this.map.save().then(function() {
				return true;
			});
		}, this));
	},

	handleSaveApply: function(ev, mode) {
		return this.handleSave(ev).then(function(saved) {
			if (saved)
				return ui.changes.apply(mode == '0');
		});
	},

	render: function(data) {
		var services = data[0];
		var serviceEnabled = uci.get('fakesip', 'main', 'enabled') === '1';
		var serviceStatus = getServiceStatus(services);
		var crontab = data[1] || '';
		var logOutput = data[2] && data[2].stdout ? data[2].stdout : '';
		var fileLog = data[3] && data[3].stdout ? data[3].stdout : '';
		var updateInfo = parseUpdateResult(data[4], 'status');
		var progressInfo = parseUpdateResult(data[5], 'progress');
		var m, s, o, p, f, enabledOpt, ifaceModeOpt, noHop, payloadTypeOpt, filterTypeOpt, silentOpt;

		this.serviceEnabled = serviceEnabled;
		this.serviceStatus = serviceStatus;
		this.crontab = crontab;
		this.updateInfo = updateInfo;
		this.updateProgress = getInitialProgressPayload(progressInfo);
		if (isUpdateProgressRunning(this.updateProgress)) {
			updateActionPending = true;
			this.updateProgressActive = true;
		}

		m = new form.Map('fakesip', 'FakeSIP');

		s = m.section(form.NamedSection, 'main', 'fakesip');
		s.anonymous = true;
		s.addremove = false;

		s.tab('status', '状态与操作');
		s.tab('basic', '基础设置');
		s.tab('advanced', '高级设置');
		s.tab('schedule', '定时重启');
		s.tab('update', '更新');
		s.tab('logs', '日志');

		enabledOpt = s.taboption('status', form.Flag, 'enabled', '启用');
		enabledOpt.rmempty = false;

		o = s.taboption('status', form.DummyValue, '_runtime', '当前状态');
		o.rawhtml = true;
		o.cfgvalue = L.bind(function() {
			return renderRuntimeStatus(this.serviceEnabled, this.serviceStatus);
		}, this);

		o = s.taboption('status', form.DummyValue, '_service_actions', '服务控制');
		o.renderWidget = L.bind(function() {
			return renderServiceActions(this.serviceStatus, this);
		}, this);

		o = s.taboption('status', form.DummyValue, '_maintenance_actions', '定时任务');
		o.renderWidget = L.bind(function() {
			return renderMaintenanceActions(this.serviceEnabled, this.serviceStatus, this.crontab, this);
		}, this);

		o = s.taboption('update', form.DummyValue, '_online_update', '版本更新');
		o.renderWidget = L.bind(function() {
			return renderUpdatePanel(this);
		}, this);

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

		o = s.taboption('advanced', form.Value, 'queue_num', 'NFQUEUE 编号');
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
		o.description = '慎选，除非必须自己维护外部防火墙规则，否则建议保持关闭。';

		o = s.taboption('advanced', form.Flag, 'use_iptables', '使用 iptables 兼容模式');
		o.rmempty = false;
		o.description = '慎选，建议优先使用 nftables；仅在确有兼容需求时开启。';

		o = s.taboption('advanced', form.Value, 'log_file', '日志文件');
		o.default = '/var/log/fakesip/fakesip.log';
		o.placeholder = '/var/log/fakesip/fakesip.log';
		o.rmempty = true;
		o.validate = validateLogPath;

		o = s.taboption('advanced', form.Value, 'log_max_size', '日志轮转大小');
		o.default = '1M';
		o.placeholder = '1M';
		o.rmempty = false;
		o.description = '对应 --log-max-size，支持纯数字字节数或 K/M/G 后缀；0 表示关闭内置轮转。';
		o.validate = validateLogMaxSize;

		o = s.taboption('advanced', form.Value, 'log_rotate_count', '日志保留份数');
		o.default = '3';
		o.placeholder = '3';
		o.rmempty = false;
		o.description = '对应 --log-rotate；0 表示超过大小后不保留历史日志。';
		o.validate = validateRange(0, 1000, '日志保留份数范围为 0 到 1000', false);

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
		o.cfgvalue = L.bind(function() {
			return renderScheduleState(this.crontab);
		}, this);

		silentOpt = s.taboption('logs', form.Flag, 'silent', '静默模式');
		silentOpt.default = '1';
		silentOpt.rmempty = false;
		silentOpt.description = '关闭会逐包输出日志，除排查问题时外，日常使用建议开启。';
		this.silentOpt = silentOpt;

		o = s.taboption('logs', form.DummyValue, '_logs');
		o.render = function() {
			return E('div', { 'class': 'cbi-value fakesip-log-value' }, [
				E('div', {
					'class': 'cbi-value-field fakesip-log-field'
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
		payloadTypeOpt.onchange = function(ev, sectionId) {
			revalidateSiblingOption(this, sectionId, 'value');
		};

		o = p.option(form.Value, 'value', '值');
		o.placeholder = 'sip:user@example.com 或 /etc/fakesip/payload.bin';
		o.rmempty = true;
		o.validate = function(sectionId, value) {
			var type = getSiblingFormValue(this, payloadTypeOpt, sectionId, 'type') || 'sip';

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

		f = m.section(form.GridSection, 'filter', '过滤规则');
		f.anonymous = true;
		f.addremove = true;
		f.addbtntitle = '添加规则';
		f.description = renderFilterOrderHelp();

		o = f.option(form.DummyValue, '_filter_order', '匹配顺序');
		o.modalonly = true;
		o.renderWidget = function() {
			return renderFilterOrderHelp();
		};

		o = f.option(form.ListValue, 'action', '动作');
		o.value('allow', '白名单');
		o.value('deny', '黑名单');
		o.default = 'allow';
		o.rmempty = false;

		filterTypeOpt = f.option(form.ListValue, 'type', '类型');
		filterTypeOpt.value('ip', 'IP / CIDR');
		filterTypeOpt.value('port', '端口 / 范围');
		filterTypeOpt.default = 'ip';
		filterTypeOpt.rmempty = false;
		filterTypeOpt.onchange = function(ev, sectionId) {
			revalidateSiblingOption(this, sectionId, 'value');
		};

		o = f.option(form.Value, 'value', '匹配值');
		o.placeholder = '1.2.3.4/24、2001:db8::/32 或 5000-6000';
		o.rmempty = false;
		o.validate = validateFilterValue(filterTypeOpt);

		this.map = m;

		return m.render().then(L.bind(function(node) {
			if (isUpdateProgressRunning(this.updateProgress))
				startUpdatePolling(this);

			return node;
		}, this));
	}
});
