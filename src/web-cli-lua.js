"use strict";

const fengari  = require('fengari');
const lua      = fengari.lua;
const lauxlib  = fengari.lauxlib;
const lualib   = fengari.lualib;
const interop  = require('fengari-interop');

const L = lauxlib.luaL_newstate();

/* open standard libraries */
lualib.luaL_openlibs(L);
lauxlib.luaL_requiref(L, lua.to_luastring("js"), interop.luaopen_js, 1);
lua.lua_pop(L, 1); /* remove lib */

lua.lua_pushstring(L, lua.to_luastring(lua.FENGARI_COPYRIGHT));
lua.lua_setglobal(L, lua.to_luastring("_COPYRIGHT"));

const msghandler = function(L) {
	let msg = lua.lua_tostring(L, 1);
	if (msg === null) {
		if (lauxlib.luaL_callmeta(L, 1, lua.to_luastring("__tostring")) &&  /* does it have a metamethod */
			lua.lua_type(L, -1) == lua.LUA_TSTRING)  /* that produces a string? */
		return 1;  /* that is the message */
	else
		msg = lua.lua_pushfstring(L, lua.to_luastring("(error object is a %s value)"), lauxlib.luaL_typename(L, 1));
	}
	lauxlib.luaL_traceback(L, L, msg, 1);  /* append a standard traceback */
	return 1;
}

const run_lua_script = function(tag, code, chunkname) {
	let ok = lauxlib.luaL_loadbuffer(L, code, null, chunkname);
	if (ok === lua.LUA_ERRSYNTAX) {
		let msg = lua.lua_tojsstring(L, -1);
		lua.lua_pop(L, 1);
		let filename = tag.src?tag.src:document.location;
		let lineno = void 0; /* TODO: extract out of msg */
		let syntaxerror = new SyntaxError(msg, filename, lineno);
		let e = new ErrorEvent("error", {
			message: msg,
			error: syntaxerror,
			filename: filename,
			lineno: lineno
		});
		window.dispatchEvent(e);
		return;
	}
	if (ok === lua.LUA_OK) {
		/* insert message handler below function */
		let base = lua.lua_gettop(L);
		lua.lua_pushcfunction(L, msghandler);
		lua.lua_insert(L, base);
		/* set document.currentScript.
		   We can't set it normally; but we can create a getter for it, then remove the getter */
		Object.defineProperty(document, 'currentScript', {
			value: tag,
			configurable: true
		});
		ok = lua.lua_pcall(L, 0, 0, base);
		/* Remove the currentScript getter installed above; this restores normal behaviour */
		delete document.currentScript;
	}
	if (ok !== lua.LUA_OK) {
		let msg = lauxlib.luaL_tolstring(L, -1);
		lua.lua_pop(L, 1);
		console.error(lua.to_jsstring(msg));
	}
};

const crossorigin_to_credentials = function(crossorigin) {
	switch(crossorigin) {
		case "anonymous": return "omit";
		case "use-credentials": return "include";
		default: return "same-origin";
	}
};

const run_lua_script_tag = function(tag) {
	if (tag.src) {
		let chunkname = lua.to_luastring("@"+tag.src);
		/* JS script tags are async after document has loaded */
		if (document.readyState === "complete" || tag.async) {
			fetch(tag.src, {
				method: "GET",
				credentials: crossorigin_to_credentials(tag.crossorigin),
				redirect: "follow",
				integrity: tag.integrity
			}).then(function(resp) {
				if (resp.ok) {
					resp.arrayBuffer().then(function(buffer) {
						let code = Array.from(new Uint8Array(buffer));
						run_lua_script(tag, code, chunkname);
					});
				} else {
					tag.dispatchEvent(new Event("error"));
				}
			});
		} else {
			/* Needs to be synchronous: use an XHR */
			let xhr = new XMLHttpRequest();
			xhr.open("GET", tag.src, false);
			xhr.send();
			if (xhr.status >= 200 && xhr.status < 300) {
				/* TODO: subresource integrity check? */
				let code = lua.to_luastring(xhr.response);
				run_lua_script(tag, code, chunkname);
			} else {
				tag.dispatchEvent(new Event("error"));
			}
		}
	} else {
		let code = lua.to_luastring(tag.innerHTML);
		let chunkname = tag.id ? lua.to_luastring("="+tag.id) : code;
		run_lua_script(tag, code, chunkname);
	}
};

/* watch for new <script type="text/lua"> tags added to document */
(new MutationObserver(function(records, observer) {
    for (let r=0; r<records.length; r++) {
        for (let i=0; i<records[r].addedNodes.length; i++) {
            let tag = records[r].addedNodes[i];
            if (tag.tagName == "SCRIPT" && tag.type == "text/lua") {
                run_lua_script_tag(tag);
            }
        }
    }
})).observe(document, {
    childList: true,
    subtree: true
});

/* run existing <script type="text/lua"> tags */
Array.prototype.forEach.call(document.querySelectorAll('script[type=\"text\/lua\"]'), run_lua_script_tag);
