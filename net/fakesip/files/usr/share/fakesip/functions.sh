#!/bin/sh

is_uint() {
	case "$1" in
		''|*[!0-9]*) return 1 ;;
	esac
	return 0
}

fakesip_log_realpath_allowed() {
	case "$1" in
		/var/log|/var/log/*|/tmp/log|/tmp/log/*|/mnt|/mnt/*|/opt|/opt/*) return 0 ;;
	esac
	return 1
}

fakesip_resolve_existing_path() {
	local path="$1"

	while [ ! -e "$path" ]; do
		[ "$path" != "/" ] || return 1
		path="${path%/*}"
		[ -n "$path" ] || path="/"
	done

	[ -d "$path" ] || return 1
	readlink -f "$path" 2>/dev/null
}

fakesip_validate_log_path() {
	local log_file="$1"
	local real_path

	[ -n "$log_file" ] || return 1

	case "$log_file" in
		/var/log/*|/mnt/*|/opt/*) ;;
		*) return 1 ;;
	esac

	case "$log_file" in
		*/../*|*/..|*/./*|*/.) return 1 ;;
	esac

	case "${log_file##*/}" in
		''|.|..) return 1 ;;
	esac

	[ ! -L "$log_file" ] || return 1

	real_path="$(readlink -f "$log_file" 2>/dev/null || fakesip_resolve_existing_path "${log_file%/*}")" || return 1
	fakesip_log_realpath_allowed "$real_path"
}
