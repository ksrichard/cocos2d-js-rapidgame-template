// from: https://gist.github.com/kevinoid/3146420

/* Implementation of HTML Timers (setInterval/setTimeout) based on sleep.
 *
 * This file is provided under the following terms (MIT License):
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 *
 * Copyright 2012 Kevin Locke <kevin@kevinlocke.name>
 */
/*jslint bitwise: true, evil: true */

/**
 * Adds methods to implement the HTML5 WindowTimers interface on a given
 * object.
 *
 * Adds the following methods:
 * <ul>
 * <li>clearInterval</li>
 * <li>clearTimeout</li>
 * <li>setInterval</li>
 * <li>setTimeout</li>
 * </ul>
 *
 * See http://www.whatwg.org/specs/web-apps/current-work/multipage/timers.html
 * for the complete specification of these methods.
 *
 * Example Usage
 * Browser compatibility in Rhino:
 * <pre><code>// Note:  "this" refers to the global object in this example
 * var timerLoop = makeWindowTimer(this, java.lang.Thread.sleep);
 *
 * // Run code which may add intervals/timeouts
 *
 * timerLoop();
 * </code></pre>
 *
 * Browser compatibility in SpiderMonkey (smjs):
 * <pre><code>// Note:  "this" refers to the global object in this example
 * var timerLoop = makeWindowTimer(this, function (ms) { sleep(ms / 1000); });
 *
 * // Run code which may add intervals/timeouts
 *
 * timerLoop();
 * </code></pre>
 *
 * For more esoteric uses, timerLoop will return instead of sleeping if passed
 * <code>true</code> which will run only events which are pending at the moment
 * timerLoop is called:
 * <pre><code>// Note:  "this" refers to the global object in this example
 * var timerLoop = makeWindowTimer(this, java.lang.Thread.sleep);
 *
 * // Run code which may add intervals/timeouts
 *
 * while (timerLoop(true)) {
 *     print("Still waiting...");
 *     // Do other work here, possibly adding more intervals/timeouts
 * }
 * </code></pre>
 *
 * @param {Object} target Object to which the methods should be added.
 * @param {Function} sleep A function which sleeps for a specified number of
 *     milliseconds.
 * @return {Function} The function which runs the scheduled timers.
 */
function makeWindowTimer(target, sleep) {
    "use strict";

    var counter = 1,
        inCallback = false,
    // Map handle -> timer
        timersByHandle = {},
    // Min-heap of timers by time then handle, index 0 unused
        timersByTime = [ null ];

    /** Compares timers based on scheduled time and handle. */
    function timerCompare(t1, t2) {
        // Note:  Only need less-than for our uses
        return t1.time < t2.time ? -1 :
            (t1.time === t2.time && t1.handle < t2.handle ? -1 : 0);
    }

    /** Fix the heap invariant which may be violated at a given index */
    function heapFixDown(heap, i, lesscmp) {
        var j, tmp;

        j = i * 2;
        while (j < heap.length) {
            if (j + 1 < heap.length &&
                lesscmp(heap[j + 1], heap[j]) < 0) {
                j = j + 1;
            }

            if (lesscmp(heap[i], heap[j]) < 0) {
                break;
            }

            tmp = heap[j];
            heap[j] = heap[i];
            heap[i] = tmp;
            i = j;
            j = i * 2;
        }
    }

    /** Fix the heap invariant which may be violated at a given index */
    function heapFixUp(heap, i, lesscmp) {
        var j, tmp;
        while (i > 1) {
            j = i >> 1;     // Integer div by 2

            if (lesscmp(heap[j], heap[i]) < 0) {
                break;
            }

            tmp = heap[j];
            heap[j] = heap[i];
            heap[i] = tmp;
            i = j;
        }
    }

    /** Remove the minimum element from the heap */
    function heapPop(heap, lesscmp) {
        heap[1] = heap[heap.length - 1];
        heap.pop();
        heapFixDown(heap, 1, lesscmp);
    }

    /** Create a timer and schedule code to run at a given time */
    function addTimer(code, delay, repeat, argsIfFn) {
        var handle, timer;

        if (typeof code !== "function") {
            code = String(code);
            argsIfFn = null;
        }
        delay = Number(delay) || 0;
        if (inCallback) {
            delay = Math.max(delay, 4);
        }
        // Note:  Must set handle after argument conversion to properly
        // handle conformance test in HTML5 spec.
        handle = counter;
        counter += 1;

        timer = {
            args: argsIfFn,
            cancel: false,
            code: code,
            handle: handle,
            repeat: repeat ? Math.max(delay, 4) : 0,
            time: new Date().getTime() + delay
        };

        timersByHandle[handle] = timer;
        timersByTime.push(timer);
        heapFixUp(timersByTime, timersByTime.length - 1, timerCompare);

        return handle;
    }

    /** Cancel an existing timer */
    function cancelTimer(handle, repeat) {
        var timer;

        if (timersByHandle.hasOwnProperty(handle)) {
            timer = timersByHandle[handle];
            if (repeat === (timer.repeat > 0)) {
                timer.cancel = true;
            }
        }
    }

    function clearInterval(handle) {
        cancelTimer(handle, true);
    }
    target.clearInterval = clearInterval;

    function clearTimeout(handle) {
        cancelTimer(handle, false);
    }
    target.clearTimeout = clearTimeout;

    function setInterval(code, delay) {
        return addTimer(
            code,
            delay,
            true,
            Array.prototype.slice.call(arguments, 2)
        );
    }
    target.setInterval = setInterval;

    function setTimeout(code, delay) {
        return addTimer(
            code,
            delay,
            false,
            Array.prototype.slice.call(arguments, 2)
        );
    }
    target.setTimeout = setTimeout;

    return function timerLoop(nonblocking) {
        var now, timer;

        // Note: index 0 unused in timersByTime
        while (timersByTime.length > 1) {
            timer = timersByTime[1];

            if (timer.cancel) {
                delete timersByHandle[timer.handle];
                heapPop(timersByTime, timerCompare);
            } else {
                now = new Date().getTime();
                if (timer.time <= now) {
                    inCallback = true;
                    try {
                        if (typeof timer.code === "function") {
                            timer.code.apply(undefined, timer.args);
                        } else {
                            eval(timer.code);
                        }
                    } finally {
                        inCallback = false;
                    }

                    if (timer.repeat > 0 && !timer.cancel) {
                        timer.time += timer.repeat;
                        heapFixDown(timersByTime, 1, timerCompare);
                    } else {
                        delete timersByHandle[timer.handle];
                        heapPop(timersByTime, timerCompare);
                    }
                } else if (!nonblocking) {
                    sleep(timer.time - now);
                } else {
                    return true;
                }
            }
        }

        return false;
    };
}

if (typeof exports === "object") {
    exports.makeWindowTimer = makeWindowTimer;
}

// vi: set sts=4 sw=4 et :












//
//  Created using [RapidGame](http://wizardfu.com/rapidgame).
//  See the `LICENSE` file for the license governing this code.
//  Developed by Nat Weiss.
//

//
// The main Game object is a singleton providing boot code, main functions, and other commonly-used, globally-accessible methods.
//
// 1. All code in this file is applicable to any game project in general.
// 2. If you need to extend the Game object with project-specific code, use [cocostest.js](cocostest.html).
//

//
// ###  Game
//
// Get or create the Game object.
//
var Game = Game || {};

//
// ###  Game.getTargetFrameRate
//
// Return the target frame rate to use. Scale back in HTML5 mode to save a CPU fan somewhere.
//
Game.getTargetFrameRate = function() {
    return this.isHtml5() ? 30 : 60;
};

//
// ###  Game.isHtml5
//
// Return true if the game is running in HTML5 mode.
//
Game.isHtml5 = function() {
    if (typeof this._isHtml5 === "undefined") {
        Game.assert(cc.sys);
        this._isHtml5 = cc.sys.isNative ? false : true;
    }
    return this._isHtml5;
};

//
// ###  Game.isDesktop
//
// Return true if the game is running on a native desktop OS.
//
Game.isDesktop = function() {
    if (typeof this._isDesktop === "undefined") {
        if (this.isHtml5()) {
            this._isDesktop = false;
        } else {
            this._isDesktop = (cc.sys.os === cc.sys.OS_OSX
                || cc.sys.os === cc.sys.OS_WINDOWS
                || cc.sys.os === cc.sys.OS_LINUX);
        }
    }
    return this._isDesktop;
};

//
// ###  Game.rand
//
// Return a random integer between 0 and the given value.
//
Game.rand = function(mod) {
    var r = Math.random();
    if (typeof mod !== 'undefined') {
        r *= 0xffffff;
        r = parseInt(r);
        r %= mod;
    }
    return r;
};

//
// ###  Game.getWinSize
//
// Return the current size of the window or screen.
//
Game.getWinSize = function() {
    var size = cc.director.getWinSizeInPixels();
    if (typeof this._winSize === 'undefined' || (size.width && size.height)) {
        this._winSize = size;
    }
    return this._winSize;
};

//
// ###  Game.centralize
//
// Return a point relative to the center of the screen and scaled.
//
Game.centralize = function(x, y) {
    var winSize = this.getWinSize();
    return cc.p(x + winSize.width * .5,
            y + winSize.height * .5);
};

//
// ###  Game.alert
//
// Safely call `alert`.
//
Game.alert = function(msg) {
    if(typeof alert === "function") {
        alert(msg);
    } else {
        cc.log(msg);
    }
};

//
// ###  Game.assert
//
// Throw an error if the given object is undefined or boolean is false.
//
Game.assert = function(objOrBool, errMsg) {
    if (typeof objOrBool === "undefined"
        || (typeof objOrBool === "boolean" && !objOrBool)
        ) {
        errMsg = errMsg || "Couldn't load the game. Please try a newer browser.";
        alert(errMsg);
        debugger;
        throw errMsg;
    }
};

//
// ###  Game.clone
//
// Clone an object or array so the original can remained unchanged. If passed an undefined value, an empty array is returned.
//
Game.clone = function(obj) {
    if(typeof obj !== "undefined") {
        return JSON.parse(JSON.stringify(obj));
    }
    return [];
};

//
// ###  Game.localizeCurrency
//
// Return the currency amount localized. Currently the method only localizes to the United States currency format.
//
Game.localizeCurrency = function(amount) {
    return "$" + parseFloat(amount).toFixed(2);
};

//
// ###  Game.getLanguageCode
//
// Return the current language code. Example: `en`.
//
Game.getLanguageCode = function() {
    var strings;

    if (typeof this._language === "undefined") {
        this._language = cc.sys.language;

        strings = Game.config["strings"];
        if (strings && typeof strings[this._language] === "undefined") {
            cc.log("Don't have strings for language: " + this._language);
            this._language = "en";
        }
    }

    return this._language;
};

//
// ###  Game.getLocalizedString
//
// Lookup and return a localized string. Configure localized strings in `Game.config["strings"][languageCode]`.
//
Game.getLocalizedString = function(key) {
    var strings,
        code = this.getLanguageCode();

    strings = Game.config["strings"][code];
    if (typeof strings[key] !== "undefined") {
        return strings[key];
    }
    if (key && key.length) {
        cc.log("Couldn't find string[" + code + "][" + key + "]");
    }
    return "";
};

//
// ###  Game.addTouchListeners
//
// Add touch listeners. Callback will get eventType, touches and event parameters.
//
Game.addTouchListeners = function(layer, callback) {
    cc.eventManager.addListener({
        event: cc.EventListener.TOUCH_ALL_AT_ONCE,
        onTouchesBegan: function(touches, event) {if(touches) {callback("began", touches, event);}},
        onTouchesMoved: function(touches, event) {if(touches) {callback("moved", touches, event);}},
        onTouchesEnded: function(touches, event) {if(touches) {callback("ended", touches, event);}},
        onTouchesCancelled: function(touches, event) {if(touches) {callback("cancelled", touches, event);}}
    }, layer);
};

//
// ###  Game.getRunningLayer
//
// Returns the running scene's child layer.
//
// Scenes can create a member variable named `layer` which will be used by this method.
//
Game.getRunningLayer = function() {
    var node = cc.director.getRunningScene();
    if (node) {
        if (node.layer) {
            node = node.layer;
        }
    }
    return node;
};

//
// ###  Game.callRunningLayer
//
// Call the running scene's layer's method.
//
Game.callRunningLayer = function(methodName, param1, param2, param3) {
    var layer = this.getRunningLayer();
    if (layer && layer[methodName]) {
        layer[methodName](param1, param2, param3);
    } else {
        /*cc.log("Couldn't find method '" + methodName + "' in running scene or layer.");*/
    }
};

//
// ###  Game.getResourcesToPreload
//
// Return an array of files to preload.
//
Game.getResourcesToPreload = function() {
    var files = Game.config["preload"],
        ret = [],
        i;

    if (files) {
        for (i = 0; i < files.length; i += 1) {
            if (files[i] && files[i].length) {
                ret[i] = files[i];
            }
        }
    }

    return ret;
};

//
// ###  Game.runInitialScene
//
// Loads resources and calls the initial scene. Called by `Game.main`.
//
Game.runInitialScene = function() {
    // cc.game.config.initialScene
    eval("cc.director.runScene(new "+cc.game.config.initialScene+"());");
};

//
// ###  Game.setCanvasSize
//
// Sets the size of the game canvas.
//
Game.setCanvasSize = function(e, w, h) {
    var allowHtmlRetina = false;
    this._pixelRatio = (allowHtmlRetina ? window.devicePixelRatio || 1 : 1);
    e = e || document.getElementById(cc.game.config[cc.game.CONFIG_KEY.id]);
    w = w || document.body.clientWidth; // or scrollWidth
    h = h || document.body.clientHeight;

    e.width = w * this._pixelRatio;
    e.height = h * this._pixelRatio;
    e.style.width = w + "px";
    e.style.height = h + "px";
    e.style.backgroundColor = document.body.style.backgroundColor;

    cc.log("Set #" + e.getAttribute("id") + " pixel ratio " + this._pixelRatio +
        ", size " + e.width + "x" + e.height +
        ", style " + e.style.width + " x " + e.style.height +
        ", parent " + e.parentNode.getAttribute("id"));

    if (typeof this._origCanvasSize === "undefined") {
        this._origCanvasSize = {width: w, height: h};
    }
};

//
// ###  Game.loadSoundEnabled
//
// Load the `soundEnabled` preference from local storage.
//
Game.loadSoundEnabled = function() {
    var enabled = cc.sys.localStorage.getItem("soundEnabled");
    /*cc.log("Loaded sound enabled: " + enabled);*/

    if (enabled === null || enabled === "") {
        this.enableSound(true);
    } else {
        this._soundEnabled = (enabled === "true" || enabled === true);
    }
    /*cc.log("Sound enabled is now: " + this._soundEnabled);*/
};

//
// ###  Game.enableSound
//
// Enable or disable sound.
//
Game.enableSound = function(enabled) {
    this._soundEnabled = enabled ? true : false;
    cc.sys.localStorage.setItem("soundEnabled", this._soundEnabled);

    if (!this.isSoundEnabled()) {
        cc.audioEngine.stopMusic();

        /* Check that the music stopped (Chrome bug). */
        cc.director.getRunningScene().schedule(function(){
            if (!Game.isSoundEnabled()) {
                cc.audioEngine.stopMusic();
            }
        }, 1, 15);
    }
};

//
// ###  Game.toggleSoundEnabled
//
// Toggle whether sound is enabled.
//
Game.toggleSoundEnabled = function() {
    this.enableSound(!this.isSoundEnabled());
};

//
// ###  Game.isSoundEnabled
//
// Return true if sound is enabled.
//
Game.isSoundEnabled = function() {
    return this._soundEnabled ? true : false;
};

//
// ###  Game.playEffect
//
// Plays the sound effect with the given filename if sound is enabled.
//
Game.playEffect = function(filename) {
    if (this.isSoundEnabled()) {
        /* Automatically prefix with resource path. */
        if (cc.loader.resPath && filename.indexOf("/") < 0) {
            filename = cc.loader.resPath + "/" + filename;
        }
        return cc.audioEngine.playEffect(filename);
    }
    return -1;
};

//
// ###  Game.stopEffect
//
// Stops the sound effect with the given id.
//
Game.stopEffect = function(audioId) {
    cc.audioEngine.stopEffect(audioId);
};

//
// ###  Game.playMusic
//
// Plays the music file with the given filename if sound is enabled.
//
Game.playMusic = function(filename) {
    if (this.isSoundEnabled()) {
        /* Automatically prefix with resource path. */
        if (cc.loader.resPath && filename.indexOf("/") < 0) {
            filename = cc.loader.resPath + "/" + filename;
        }
        cc.audioEngine.stopMusic();
        cc.audioEngine.playMusic(filename, true);
    }
};

//
// ###  Game.stopMusic
//
// Stop music.
//
Game.stopMusic = function() {
    cc.audioEngine.stopMusic();
};

//
// ###  Game.startPhysics
//
// Start the physics engine.
//
Game.startPhysics = function(gravity) {
    if (this.space !== "undefined") {
        this.space = null;
    }

    this.space = new cp.Space();
    this.space.gravity = cp.v(gravity.x, gravity.y);
    this._physicsAccumulator = 0;

    if (cc.game.config.debugPhysics) {
        this._physicsDebugNode = cc.PhysicsDebugNode.create(this.space);
        cc.director.getRunningScene().addChild(this._physicsDebugNode, 100);
    }
};

//
// ###  Game.stepPhysics
//
// Step the physics engine.
//
Game.stepPhysics = function(delta) {
    var step = 1 / 60;
    this._physicsAccumulator += delta;
    while (this._physicsAccumulator > step) {
        Game.space.step(step);
        this._physicsAccumulator -= step;
    }
};

//
// ###  Game.createPhysicsBox
//
// Create a static physics box.
//
Game.createPhysicsBox = function(_x1, _y1, _x2, _y2, elasticity, friction, collisionType) {
    var w = (_x2 - _x1) || 2,
        h = (_y2 - _y1) || 2,
        box = new cp.BoxShape(this.space.staticBody, Math.abs(w), Math.abs(h));
    box.body.setPos(cp.v(_x1 + w * .5, _y1 + h * .5));
    box.setElasticity(elasticity || 1);
    box.setFriction(friction || 0);
    box.setCollisionType(collisionType || 0);
    this.space.addStaticShape(box);
    return box;
};

//
// ###  Game.createPhysicsSprite
//
// Create a dynamic physics sprite.
//
Game.createPhysicsSprite = function(filename, elasticity, friction, isCircle, collisionType) {
    var sprite = cc.PhysicsSprite.create(filename),
        body,
        shape,
        w = sprite.width || 1,
        h = sprite.height || 1;

    body = new cp.Body(1, cp.momentForBox(1, w, h))
    this.space.addBody(body);

    if (isCircle) {
        shape = new cp.CircleShape(body, w * .5, cp.v(0,0));
    } else {
        shape = new cp.BoxShape(body, w, h);
    }
    shape.setElasticity(elasticity || 1);
    shape.setFriction(friction || 0);
    shape.setCollisionType(collisionType || 0);
    this.space.addShape(shape);

    sprite.setBody(body);

    return sprite;
};


//
// ###  Game.boot
//
// Boot method. Different for HTML5 versus native. Called at the end of this file.
//
Game.boot = function(global) {
    cc.loader.resPath = cc.game.config.resourcePath;

    if (this.isHtml5()) {
        Game.setCanvasSize();
        Game.setCanvasSize(document.getElementById("gameDiv"),
            this._origCanvasSize.width, this._origCanvasSize.height);
    } else {
        /* Implement timers. */
        this.timerLoop = makeWindowTimer(global, function(ms){});
        cc.director.getScheduler().scheduleCallbackForTarget(this, this.timerLoop);
    }

    /*setTimeout(function(){cc.log("Confirmed setTimeout() works");}, 3333);*/

    /* Embed the equivalent of main.js for faster loading. */
    cc.game.onStart = function(){
        Game.main();
    };

    /*
     Native client boot happens like this:
     1. cc.game.run() ->
     2. cc.game.prepare() ->
     3. jsb.js ->
     4. jsb_cocos2d.js, etc...
     */
    cc.game.run();
};

//
// ###  Game.main
//
// The main method. Called by `cc.game.onStart`.
//
Game.main = function() {
    var i,
        size = {},
        sheets,
        cacher,
        dirs = [];

    /* Get config */
    Game.config = Game.config || {};
    for (i in cc.game.config) {
        if (cc.game.config.hasOwnProperty(i)) {
            Game.config[i] = Game.clone(cc.game.config[i]);
        }
    }

    this.loadSoundEnabled();

    cc.defineGetterSetter(Game, "winSize", Game.getWinSize);
    Game.contentWidth = cc.game.config.designWidth || Game.winSize.width;
    Game.contentHeight = cc.game.config.designHeight || Game.winSize.height;
    if (Game.winSize.width > Game.winSize.height) {
        size.width = (Game.contentHeight / Game.winSize.height) * Game.winSize.width;
        size.height = Game.contentHeight;
        Game.contentX = (size.width - Game.contentWidth) * .5;
        Game.contentY = 0;
    } else {
        size.width = Game.contentWidth;
        size.height = (Game.contentWidth / Game.winSize.width) * Game.winSize.height;
        Game.contentX = 0;
        Game.contentY = (size.height - Game.contentHeight) * .5;
    }
    cc.director.setDisplayStats(cc.game.config[cc.game.CONFIG_KEY.showFPS]);
    cc.view.setDesignResolutionSize(size.width, size.height, cc.ResolutionPolicy.SHOW_ALL);
    cc.view.resizeWithBrowserSize(true);

    cc.director.setAnimationInterval(1.0 / this.getTargetFrameRate());
    cc.log(parseInt(Game.winSize.width) + "x" + parseInt(Game.winSize.height)
        + " [" + parseInt(Game.contentX) + "," + parseInt(Game.contentY) + " "
        + parseInt(Game.contentWidth) + "x" + parseInt(Game.contentHeight) + "]"
        + ", language: " + Game.getLanguageCode()
        + ", " + parseInt(1.0 / cc.director.getAnimationInterval()) + " fps");

    if (this.isHtml5()) {
        Game.addImageData = function() {};
    } else {
        Game.config["font"] = cc.loader.resPath + "/" + Game.config["font"] + ".ttf";
    }

    if (typeof Game.initPro === "function") {
        Game.initPro();
    }

    /* Preload. */
    cc.LoaderScene.preload(g_resources, Game.runInitialScene, this);
};

//
// ###  Boot
//
// Call `Game.boot` passing in the global variable.
//
Game.boot(this);