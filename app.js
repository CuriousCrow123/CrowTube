/* ═══════════════════════════════════════════
   CrowTube — Application Logic
   ═══════════════════════════════════════════ */

(function () {

  /* ── Utilities ── */

  function escapeHtml(str) {
    var div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function parseTime(str) {
    if (!str || !str.trim()) return null;
    var parts = str.trim().split(":").map(Number);
    if (parts.some(isNaN)) return null;
    if (parts.length === 1) return parts[0];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    return null;
  }

  function formatTime(secs) {
    if (secs === null) return "";
    return Math.floor(secs / 60) + ":" + String(Math.floor(secs % 60)).padStart(2, "0");
  }

  function extractVideoId(input) {
    input = input.trim();
    if (/^[a-zA-Z0-9_-]{11}$/.test(input)) return input;
    var patterns = [
      /(?:youtube\.com\/watch\?.*v=)([a-zA-Z0-9_-]{11})/,
      /(?:youtu\.be\/)([a-zA-Z0-9_-]{11})/,
      /(?:youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
      /(?:youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/
    ];
    for (var i = 0; i < patterns.length; i++) {
      var match = input.match(patterns[i]);
      if (match) return match[1];
    }
    return null;
  }

  /* ── State ── */

  var STORAGE_KEY = "crowtube";

  var player = null;              // YouTube player instance
  var playlist = [];              // Array of { id, title, start, end }
  var currentIndex = -1;          // Index of currently playing video
  var loopEnabled = true;         // Queue looping on/off
  var shuffleEnabled = false;     // Shuffle mode on/off
  var loopCount = 0;              // Number of full queue loops completed
  var shufflePlayed = {};         // Tracks indices played in current shuffle round

  var rangeStart = null;          // Play range start (seconds)
  var rangeEnd = null;            // Play range end (seconds)
  var rangeCheckInterval = null;  // Interval ID for range-end polling

  var rainAudio = null;           // Rain <audio> element reference
  var rainOn = false;             // Rain is currently playing
  var rainVolume = 0.3;           // Rain volume (0–1)
  var rainFadeInterval = null;    // Rain volume fade interval ID

  var advancing = false;          // Guard against re-entrance in advanceQueue
  var rangeCheckStopping = false; // Guard for range-check stop race condition

  /* ── Persistence ── */

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        pl: playlist, ci: currentIndex, loop: loopEnabled,
        shuffle: shuffleEnabled, rainOn: rainOn, rainVol: rainVolume
      }));
    } catch (e) {}
  }

  function loadState() {
    try {
      var data = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (data && Array.isArray(data.pl)) {
        playlist = data.pl;
        currentIndex = typeof data.ci === "number" ? data.ci : -1;
        if (typeof data.loop === "boolean") loopEnabled = data.loop;
        if (typeof data.shuffle === "boolean") shuffleEnabled = data.shuffle;
        if (typeof data.rainOn === "boolean") rainOn = data.rainOn;
        if (typeof data.rainVol === "number") rainVolume = data.rainVol;
      }
    } catch (e) {}
  }

  /* ── Status Bar ── */

  var statusFading = false;
  var statusTimer = null;

  function setStatus(msg, skipFade) {
    var el = document.getElementById("status");
    if (skipFade || !el.innerHTML || !el.offsetParent) { el.innerHTML = msg; return; }
    if (statusFading) { el.classList.remove("fade-out"); void el.offsetWidth; }
    statusFading = true;
    el.classList.add("fade-out");
    setTimeout(function () {
      el.innerHTML = msg;
      el.classList.remove("fade-out");
      statusFading = false;
    }, 300);
  }

  function flashStatus(msg) {
    setStatus(msg);
    if (statusTimer) clearTimeout(statusTimer);
    statusTimer = setTimeout(function () {
      if (currentIndex >= 0 && playlist[currentIndex] && player &&
          player.getPlayerState && player.getPlayerState() === YT.PlayerState.PLAYING) {
        setStatus("Playing: " + playlist[currentIndex].title);
      }
      statusTimer = null;
    }, 1800);
  }

  function updateLoopBadge() {
    var badge = document.getElementById("loop-badge");
    if (loopCount === 0) {
      badge.className = "loop-badge";
      badge.innerHTML = '<span class="inf">&#8734;</span> loops';
    } else {
      badge.className = "loop-badge counting";
      badge.innerHTML = loopCount + " loop" + (loopCount !== 1 ? "s" : "");
    }
  }

  function showToast(msg) {
    var t = document.getElementById("toast");
    t.textContent = msg;
    t.classList.add("show");
    setTimeout(function () { t.classList.remove("show"); }, 2200);
  }

  /* ── Share Links ── */

  function encodeShareHash() {
    if (!playlist.length) return null;
    var parts = [];
    for (var i = 0; i < playlist.length; i++) {
      var part = playlist[i].id;
      if (playlist[i].start !== null || playlist[i].end !== null) {
        part += "," + (playlist[i].start !== null ? playlist[i].start : "")
              + "," + (playlist[i].end !== null ? playlist[i].end : "");
      }
      parts.push(part);
    }
    var hash = parts.join("|");
    if (rainOn) hash += "&rain=1&rvol=" + Math.round(rainVolume * 100);
    return hash;
  }

  function decodeShareHash(hash) {
    if (!hash) return null;
    // Parse flags after "&"
    var flags = {};
    var ampIdx = hash.indexOf("&");
    var videoPart = hash;
    if (ampIdx !== -1) {
      var flagStr = hash.slice(ampIdx + 1);
      videoPart = hash.slice(0, ampIdx);
      var pairs = flagStr.split("&");
      for (var f = 0; f < pairs.length; f++) {
        var kv = pairs[f].split("=");
        if (kv.length === 2) flags[kv[0]] = kv[1];
      }
    }
    var items = videoPart.split("|");
    var result = [];
    for (var i = 0; i < items.length; i++) {
      var seg = items[i].split(",");
      var id = seg[0];
      if (!id || !/^[a-zA-Z0-9_-]{11}$/.test(id)) continue;
      var start = seg[1] !== undefined && seg[1] !== "" ? Number(seg[1]) : null;
      var end = seg[2] !== undefined && seg[2] !== "" ? Number(seg[2]) : null;
      if (start !== null && isNaN(start)) start = null;
      if (end !== null && isNaN(end)) end = null;
      result.push({ id: id, title: "Video " + id, start: start, end: end });
    }
    if (!result.length) return null;
    var rvol = flags.rvol !== undefined ? Number(flags.rvol) / 100 : null;
    if (rvol !== null && (isNaN(rvol) || rvol < 0 || rvol > 1)) rvol = null;
    return { videos: result, rain: flags.rain === "1", rainVol: rvol };
  }

  function handleShare() {
    if (!playlist.length) { setStatus("Nothing to share"); return; }
    var encoded = encodeShareHash();
    var url = window.location.origin + window.location.pathname + "#" + encoded;
    navigator.clipboard.writeText(url).then(function () {
      showToast("Link copied to clipboard!");
    }).catch(function () {
      showToast("Couldn\u2019t copy \u2014 check console");
      console.log("Share URL:", url);
    });
  }

  function loadFromHash() {
    var raw = window.location.hash.slice(1);
    if (!raw) return false;
    try { raw = decodeURIComponent(raw); } catch (e) {}
    var data = decodeShareHash(raw);
    if (!data) return false;
    playlist = data.videos;
    currentIndex = 0;
    if (data.rain && !rainOn) {
      rainOn = true;
      document.getElementById("rain-btn").innerHTML = "&#127783; Rain: ON";
      document.getElementById("rain-vol").classList.add("show");
    }
    if (data.rainVol !== null) {
      rainVolume = data.rainVol;
      document.getElementById("rain-vol").value = Math.round(rainVolume * 100);
      if (rainAudio) rainAudio.volume = rainVolume;
    }
    history.replaceState(null, "", window.location.pathname);
    renderPlaylist();
    if (player && player.loadVideoById) {
      restoreRange();
      player.loadVideoById(playlist[0].id);
      setStatus("Playing: " + playlist[0].title);
    }
    for (var i = 0; i < playlist.length; i++) fetchTitle(playlist[i].id, i);
    return true;
  }

  /* ── Visualizer ── */

  var vizBars = [], vizAnimation = null, vizActive = false, vizEnergy = 0, vizTime = 0;

  function initVisualizer() {
    var vizEl = document.getElementById("viz");
    if (!vizEl) return;
    var barCount = 40;
    for (var i = 0; i < barCount; i++) {
      var bar = document.createElement("div");
      bar.className = "viz-bar";
      bar.style.height = "3px";
      vizEl.appendChild(bar);
      vizBars.push({ el: bar, phase: (i / barCount) * Math.PI * 2, vel: 0.8 + Math.random() * 1.4 });
    }
    vizAnimation = requestAnimationFrame(visualizerTick);
  }

  function visualizerTick() {
    var target = vizActive ? 1 : 0;
    vizEnergy += (target - vizEnergy) * (vizActive ? 0.08 : 0.04);
    if (vizEnergy < 0.005) vizEnergy = 0;
    vizTime += 0.06;
    for (var i = 0; i < vizBars.length; i++) {
      var vb = vizBars[i];
      var idleH = 3 + 4 * Math.abs(Math.sin(vizTime * 0.4 + vb.phase));
      var playH = 3 + 17 * Math.abs(Math.sin(vizTime * vb.vel + vb.phase * 2.3))
                    * (0.5 + 0.5 * Math.sin(vizTime * 0.7 + vb.phase * 1.1));
      var h = idleH + (playH - idleH) * vizEnergy;
      vb.el.style.height = h.toFixed(1) + "px";
    }
    vizAnimation = requestAnimationFrame(visualizerTick);
  }

  function setVisualizerActive(on) {
    vizActive = on;
    var v = document.getElementById("viz");
    if (v) { if (on) v.classList.add("active"); else v.classList.remove("active"); }
  }

  /* ── Rain Audio ── */

  function initRainAudio() {
    if (rainAudio) return;
    rainAudio = document.getElementById("rain-audio");
    rainAudio.volume = 0;
  }

  function fadeRainVolume(target, duration) {
    if (!rainAudio) return;
    if (rainFadeInterval) clearInterval(rainFadeInterval);
    var start = rainAudio.volume, diff = target - start;
    if (Math.abs(diff) < 0.01) { rainAudio.volume = target; return; }
    var steps = Math.ceil(duration / 20), step = 0;
    rainFadeInterval = setInterval(function () {
      step++;
      var vol = start + diff * (step / steps);
      rainAudio.volume = Math.max(0, Math.min(1, vol));
      if (step >= steps) { clearInterval(rainFadeInterval); rainFadeInterval = null; }
    }, 20);
  }

  function startRain() {
    initRainAudio();
    rainAudio.volume = rainVolume;
    var p = rainAudio.play();
    if (p && p.catch) p.catch(function (err) {
      console.error("Rain play failed:", err);
      setStatus("Rain: tap to enable audio");
    });
    setRainVisual(true);
  }

  function stopRain() {
    if (!rainAudio) return;
    fadeRainVolume(0, 500);
    setTimeout(function () { if (!rainOn && rainAudio) rainAudio.pause(); }, 600);
    setRainVisual(false);
  }

  function toggleRain() {
    rainOn = !rainOn;
    document.getElementById("rain-btn").innerHTML = "&#127783; Rain" + (rainOn ? ": ON" : "");
    document.getElementById("rain-vol").classList.toggle("show", rainOn);
    if (rainOn) startRain(); else stopRain();
    saveState();
  }

  function handleRainVolume(e) {
    rainVolume = e.target.value / 100;
    if (rainOn && rainAudio) rainAudio.volume = rainVolume;
    saveState();
  }

  /* ── Rain Canvas ── */

  var rainCanvas = null, rainCtx = null, rainDrops = [], rainSpawning = false;

  function initRainCanvas() {
    rainCanvas = document.getElementById("rain-canvas");
    if (!rainCanvas) return;
    rainCtx = rainCanvas.getContext("2d");
    resizeRainCanvas();
    window.addEventListener("resize", resizeRainCanvas);
  }

  function resizeRainCanvas() {
    if (!rainCanvas) return;
    rainCanvas.width = window.innerWidth;
    rainCanvas.height = window.innerHeight;
  }

  function setRainVisual(on) {
    if (!rainCanvas) initRainCanvas();
    if (!rainCanvas) return;
    rainSpawning = on;
    if (on) {
      rainCanvas.style.opacity = "1";
      if (!rainCanvas._animating) {
        rainCanvas._animating = true;
        for (var i = 0; i < 120; i++) {
          rainDrops.push({
            x: Math.random() * rainCanvas.width,
            y: Math.random() * rainCanvas.height,
            len: 12 + Math.random() * 22,
            speed: 4 + Math.random() * 8,
            opacity: 0.04 + Math.random() * 0.1
          });
        }
        animateRain();
      }
    }
  }

  function animateRain() {
    if (!rainCanvas || !rainCanvas._animating) return;
    var ctx = rainCtx, w = rainCanvas.width, h = rainCanvas.height;
    ctx.clearRect(0, 0, w, h);
    for (var i = rainDrops.length - 1; i >= 0; i--) {
      var drop = rainDrops[i];
      drop.y += drop.speed;
      drop.x -= drop.speed * 0.15;
      if (drop.y > h || drop.x < -10) {
        if (rainSpawning) {
          drop.y = -drop.len;
          drop.x = Math.random() * (w + 60);
          drop.len = 12 + Math.random() * 22;
          drop.speed = 4 + Math.random() * 8;
          drop.opacity = 0.04 + Math.random() * 0.1;
        } else {
          rainDrops.splice(i, 1);
          continue;
        }
      }
      ctx.beginPath();
      ctx.moveTo(drop.x, drop.y);
      ctx.lineTo(drop.x - drop.len * 0.15, drop.y + drop.len);
      ctx.strokeStyle = "rgba(200,210,230," + drop.opacity + ")";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    if (!rainSpawning && rainDrops.length === 0) {
      rainCanvas._animating = false;
      rainCanvas.style.opacity = "0";
      ctx.clearRect(0, 0, w, h);
      return;
    }
    requestAnimationFrame(animateRain);
  }

  /* ── Queue Logic ── */

  function isQueueFinished() {
    if (loopEnabled) return false;
    if (playlist.length <= 1) return true;
    if (!shuffleEnabled && currentIndex + 1 >= playlist.length) return true;
    if (shuffleEnabled && shufflePick() === -1) return true;
    return false;
  }

  function finishQueue() {
    player.seekTo(rangeEnd || player.getDuration(), true);
    player.pauseVideo();
    advancing = false;
    setStatus("Queue finished");
    setVisualizerActive(false);
  }

  function shufflePick() {
    var remaining = [];
    for (var j = 0; j < playlist.length; j++) {
      if (j !== currentIndex && !shufflePlayed[j]) remaining.push(j);
    }
    if (remaining.length === 0) {
      if (loopEnabled) {
        loopCount++;
        updateLoopBadge();
        shufflePlayed = {};
        for (var j = 0; j < playlist.length; j++) {
          if (j !== currentIndex) remaining.push(j);
        }
      } else {
        return -1;
      }
    }
    return remaining[Math.floor(Math.random() * remaining.length)];
  }

  function advanceQueue() {
    if (advancing) return;
    advancing = true;
    stopRangeChecker();

    if (playlist.length <= 1) {
      if (loopEnabled) { seekToStart(); player.playVideo(); loopCount++; updateLoopBadge(); }
      else { finishQueue(); }
    } else if (shuffleEnabled) {
      var pick = shufflePick();
      if (pick === -1) { finishQueue(); }
      else { shufflePlayed[currentIndex] = true; playVideoAtIndex(pick); }
    } else {
      var next = currentIndex + 1;
      if (next < playlist.length) {
        playVideoAtIndex(next);
      } else if (loopEnabled) {
        loopCount++;
        updateLoopBadge();
        playVideoAtIndex(0);
      } else {
        finishQueue();
      }
    }
  }

  function startRangeChecker() {
    stopRangeChecker();
    rangeCheckStopping = false;
    if (rangeEnd !== null) {
      rangeCheckInterval = setInterval(function () {
        if (rangeCheckStopping) return;
        if (player && player.getCurrentTime && rangeEnd !== null && player.getCurrentTime() >= rangeEnd) {
          if (isQueueFinished()) {
            rangeCheckStopping = true;
            stopRangeChecker();
            player.pauseVideo();
            setStatus("Queue finished");
            setVisualizerActive(false);
          } else {
            advanceQueue();
          }
        }
      }, 250);
    }
  }

  function stopRangeChecker() {
    if (rangeCheckInterval) { clearInterval(rangeCheckInterval); rangeCheckInterval = null; }
  }

  /* ── Playback ── */

  function seekToStart() {
    player.seekTo(rangeStart || 0, true);
  }

  function playVideoAtIndex(index, manual) {
    if (index < 0 || index >= playlist.length) return;
    if (!player || !player.loadVideoById) { setStatus("Player not ready"); return; }
    currentIndex = index;
    if (manual) { loopCount = 0; updateLoopBadge(); }
    restoreRange();
    player.loadVideoById({ videoId: playlist[index].id, startSeconds: rangeStart || 0 });
    renderPlaylist();
    setStatus("Playing: " + playlist[index].title);
  }
  window.playVideoAtIndex = playVideoAtIndex;

  function restoreRange() {
    stopRangeChecker();
    if (currentIndex >= 0 && playlist[currentIndex] &&
        (playlist[currentIndex].start !== null || playlist[currentIndex].end !== null)) {
      rangeStart = playlist[currentIndex].start;
      rangeEnd = playlist[currentIndex].end;
      document.getElementById("start-time").value = formatTime(rangeStart);
      document.getElementById("end-time").value = formatTime(rangeEnd);
      startRangeChecker();
    } else {
      rangeStart = null;
      rangeEnd = null;
      document.getElementById("start-time").value = "";
      document.getElementById("end-time").value = "";
    }
  }

  function fetchTitle(videoId, index) {
    fetch("https://noembed.com/embed?url=https://www.youtube.com/watch?v=" + videoId)
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.title && playlist[index]) {
          playlist[index].title = data.title;
          renderPlaylist();
          if (index === currentIndex) setStatus("Playing: " + data.title);
        }
      })
      .catch(function () { if (index === currentIndex) setStatus("Playing: " + videoId); });
  }

  function addVideoToQueue(id) {
    var index = playlist.length;
    playlist.push({ id: id, title: "Video " + id, start: null, end: null });
    return index;
  }

  function handlePlay() {
    var input = document.getElementById("url-input").value;
    var id = extractVideoId(input);
    if (!id) { setStatus("Invalid YouTube URL"); return; }
    loopCount = 0;
    updateLoopBadge();
    var existingIndex = -1;
    for (var i = 0; i < playlist.length; i++) { if (playlist[i].id === id) { existingIndex = i; break; } }
    if (existingIndex === -1) { addVideoToQueue(id); currentIndex = playlist.length - 1; }
    else { currentIndex = existingIndex; }
    restoreRange();
    if (player && player.loadVideoById) player.loadVideoById({ videoId: id, startSeconds: rangeStart || 0 });
    renderPlaylist();
    setStatus("Loading...");
    fetchTitle(id, currentIndex);
  }

  function handleQueue() {
    var input = document.getElementById("url-input").value;
    var id = extractVideoId(input);
    if (!id) { setStatus("Invalid YouTube URL"); return; }
    var index = addVideoToQueue(id);
    renderPlaylist();
    setStatus("Added to queue");
    document.getElementById("url-input").value = "";
    fetchTitle(id, index);
  }

  function handleNext() {
    if (!playlist.length) return;
    if (shuffleEnabled && playlist.length > 1) {
      shufflePlayed[currentIndex] = true;
      var pick = shufflePick();
      if (pick === -1) { shufflePlayed = {}; pick = Math.floor(Math.random() * playlist.length); }
      playVideoAtIndex(pick, true);
    } else {
      playVideoAtIndex((currentIndex + 1) % playlist.length, true);
    }
  }

  function handleRestart() {
    if (player && player.seekTo) { seekToStart(); player.playVideo(); }
  }

  /* ── Playlist UI ── */

  function syncQueueHeight() {
    var left = document.querySelector(".main-left");
    var queuePanel = document.querySelector(".main-right .queue-panel");
    var queueList = document.querySelector(".main-right .queue-list");
    if (!left || !queuePanel || !queueList) return;
    if (window.innerWidth <= 900) {
      queuePanel.style.height = "";
      queueList.style.maxHeight = "300px";
    } else {
      queuePanel.style.height = "0px";
      queuePanel.style.overflow = "hidden";
      var h = left.offsetHeight;
      queuePanel.style.height = h + "px";
      queuePanel.style.overflow = "";
      queueList.style.maxHeight = "";
    }
  }
  window.addEventListener("resize", syncQueueHeight);

  /* ── Drag & Drop Reorder ── */

  var dragFromIndex = null;

  function initDragListeners() {
    var container = document.getElementById("queue-content");

    container.addEventListener("dragstart", function (e) {
      var item = e.target.closest(".queue-item");
      if (!item) return;
      dragFromIndex = parseInt(item.dataset.index, 10);
      item.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
    });

    function clearDragIndicators() {
      var items = container.querySelectorAll(".queue-item");
      for (var i = 0; i < items.length; i++) {
        items[i].classList.remove("drag-over-top", "drag-over-bottom");
      }
    }

    container.addEventListener("dragend", function (e) {
      var item = e.target.closest(".queue-item");
      if (item) item.classList.remove("dragging");
      dragFromIndex = null;
      clearDragIndicators();
    });

    container.addEventListener("dragover", function (e) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      var item = e.target.closest(".queue-item");
      if (!item) return;
      clearDragIndicators();
      var idx = parseInt(item.dataset.index, 10);
      if (idx === dragFromIndex) return;
      // Detect top vs bottom half
      var rect = item.getBoundingClientRect();
      var midY = rect.top + rect.height / 2;
      if (e.clientY < midY) {
        item.classList.add("drag-over-top");
      } else {
        item.classList.add("drag-over-bottom");
      }
    });

    container.addEventListener("dragleave", function (e) {
      var item = e.target.closest(".queue-item");
      if (item) item.classList.remove("drag-over-top", "drag-over-bottom");
    });

    container.addEventListener("drop", function (e) {
      e.preventDefault();
      var item = e.target.closest(".queue-item");
      if (!item || dragFromIndex === null) return;
      var idx = parseInt(item.dataset.index, 10);
      if (idx === dragFromIndex) return;

      // Determine actual insert position based on which half was targeted
      var rect = item.getBoundingClientRect();
      var midY = rect.top + rect.height / 2;
      var dropIndex = e.clientY < midY ? idx : idx + 1;

      // Adjust dropIndex if dragging from before the drop point
      var fromIdx = dragFromIndex;
      var moved = playlist.splice(fromIdx, 1)[0];
      if (fromIdx < dropIndex) dropIndex--;
      playlist.splice(dropIndex, 0, moved);

      // Update currentIndex to follow the playing video
      if (currentIndex === fromIdx) {
        currentIndex = dropIndex;
      } else if (fromIdx < currentIndex && dropIndex >= currentIndex) {
        currentIndex--;
      } else if (fromIdx > currentIndex && dropIndex <= currentIndex) {
        currentIndex++;
      }

      dragFromIndex = null;
      renderPlaylist();
    });
  }

  function renderPlaylist() {
    saveState();
    var container = document.getElementById("queue-content");
    if (!playlist.length) {
      container.innerHTML = '<div class="queue-empty">No videos in queue &#8212; add some!</div>';
      syncQueueHeight();
      return;
    }
    var html = "";
    for (var i = 0; i < playlist.length; i++) {
      var hasRange = playlist[i].start !== null || playlist[i].end !== null;
      html += '<div class="queue-item' + (i === currentIndex ? ' active' : '') + '" draggable="true" data-index="' + i + '" onclick="playVideoAtIndex(' + i + ',true)">';
      html += '<span class="item-index">' + String(i + 1).padStart(2, "0") + '</span>';
      html += '<span class="item-title">' + escapeHtml(playlist[i].title) + '</span>';
      if (hasRange) {
        html += '<span class="item-range">' + formatTime(playlist[i].start || 0) + '&#8594;' + (playlist[i].end !== null ? formatTime(playlist[i].end) : 'end');
        html += '<span class="range-clear" onclick="event.stopPropagation();clearPlayRange(' + i + ')">&#215;</span></span>';
      }
      html += '<button class="item-copy" onclick="event.stopPropagation();copyVideoLink(' + i + ')" title="Copy link">&#128279;</button>';
      html += '<button class="item-remove" onclick="event.stopPropagation();removeFromPlaylist(' + i + ')">&#215;</button>';
      html += '</div>';
    }
    container.innerHTML = html;
    syncQueueHeight();
  }

  window.removeFromPlaylist = function (i) {
    playlist.splice(i, 1);
    if (currentIndex >= playlist.length) currentIndex = playlist.length - 1;
    renderPlaylist();
  };

  window.copyVideoLink = function (i) {
    if (i < 0 || i >= playlist.length) return;
    var video = playlist[i];
    var url = "https://youtu.be/" + video.id;
    navigator.clipboard.writeText(url).then(function () {
      showToast("YouTube link copied!");
    }).catch(function () {
      showToast("Couldn\u2019t copy \u2014 check console");
      console.log("Link:", url);
    });
  };

  window.clearPlayRange = function (i) {
    if (i < 0 || i >= playlist.length) return;
    playlist[i].start = null;
    playlist[i].end = null;
    if (i === currentIndex) { rangeStart = null; rangeEnd = null; stopRangeChecker(); }
    renderPlaylist();
    flashStatus("Cleared play range for " + playlist[i].title);
  };

  function handleClearAll() {
    playlist = [];
    currentIndex = -1;
    renderPlaylist();
    saveState();
  }

  /* ── Play Range Controls ── */

  function handleSetRange() {
    var start = parseTime(document.getElementById("start-time").value);
    var end = parseTime(document.getElementById("end-time").value);
    rangeStart = start;
    rangeEnd = end;
    if (start !== null) document.getElementById("start-time").value = formatTime(start);
    if (end !== null) document.getElementById("end-time").value = formatTime(end);
    if (currentIndex >= 0 && playlist[currentIndex]) {
      playlist[currentIndex].start = start;
      playlist[currentIndex].end = end;
      renderPlaylist();
    }
    if (start !== null && player) player.seekTo(start, true);
    startRangeChecker();
    flashStatus("Trim: " + formatTime(start || 0) + " &#8594; " + (end !== null ? formatTime(end) : "end"));
  }

  function handleClearRange() {
    rangeStart = null;
    rangeEnd = null;
    document.getElementById("start-time").value = "";
    document.getElementById("end-time").value = "";
    if (currentIndex >= 0 && playlist[currentIndex]) {
      playlist[currentIndex].start = null;
      playlist[currentIndex].end = null;
      renderPlaylist();
    }
    stopRangeChecker();
  }

  /* ── Toggle Controls ── */

  function toggleLoop() {
    loopEnabled = !loopEnabled;
    document.getElementById("loop-btn").innerHTML = "&#8635; Loop: " + (loopEnabled ? "ON" : "OFF");
    flashStatus(loopEnabled ? "Looping enabled" : "Looping disabled");
    saveState();
  }

  function toggleShuffle() {
    shuffleEnabled = !shuffleEnabled;
    shufflePlayed = {};
    document.getElementById("shuffle-btn").innerHTML = "&#9876; Shuffle: " + (shuffleEnabled ? "ON" : "OFF");
    flashStatus(shuffleEnabled ? "Shuffle enabled" : "Shuffle disabled");
    saveState();
  }

  /* ── YouTube Player ── */

  function loadYouTubeAPI() {
    var script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(script);
  }

  window.onYouTubeIframeAPIReady = function () {
    player = new YT.Player("player-target", {
      height: "100%", width: "100%",
      playerVars: { autoplay: 0, controls: 1, rel: 0, modestbranding: 1, iv_load_policy: 3 },
      events: {
        onReady: function () {
          renderPlaylist();
          if (playlist.length && currentIndex >= 0 && currentIndex < playlist.length) {
            restoreRange();
            player.cueVideoById({ videoId: playlist[currentIndex].id, startSeconds: rangeStart || 0 });
            setStatus("Restored: " + playlist[currentIndex].title);
            for (var i = 0; i < playlist.length; i++) fetchTitle(playlist[i].id, i);
          } else {
            setStatus("Player ready");
          }
        },
        onStateChange: function (e) {
          if (e.data === YT.PlayerState.ENDED) {
            setVisualizerActive(false);
            advanceQueue();
          }
          if (e.data === YT.PlayerState.PLAYING) {
            document.getElementById("player-placeholder").style.display = "none";
            setVisualizerActive(true);
            advancing = false;
            rangeCheckStopping = false;
            if (currentIndex >= 0 && playlist[currentIndex]) {
              setStatus("Playing: " + playlist[currentIndex].title, true);
            }
            startRangeChecker();
          } else if (e.data === YT.PlayerState.PAUSED || e.data === YT.PlayerState.BUFFERING) {
            setVisualizerActive(false);
            stopRangeChecker();
          }
        }
      }
    });
  };

  /* ── Init ── */

  // Build visualizer
  initVisualizer();

  // Detect file:// and show instructions
  if (window.location.protocol === "file:") {
    document.getElementById("file-warning").style.display = "flex";
    document.getElementById("main-app").style.display = "none";
    return;
  }

  // Load state from share link or localStorage
  if (!loadFromHash()) {
    loadState();
  }

  // Re-import if user navigates to a share link while already on the page
  window.addEventListener("hashchange", function () { loadFromHash(); });

  // Sync UI to restored state
  if (!loopEnabled) document.getElementById("loop-btn").innerHTML = "&#8635; Loop: OFF";
  if (shuffleEnabled) document.getElementById("shuffle-btn").innerHTML = "&#9876; Shuffle: ON";
  if (rainOn) {
    document.getElementById("rain-btn").innerHTML = "&#127783; Rain: ON";
    document.getElementById("rain-vol").classList.add("show");
  }
  document.getElementById("rain-vol").value = Math.round(rainVolume * 100);

  // Load YouTube IFrame API
  loadYouTubeAPI();

  // Bind event listeners
  document.getElementById("play-btn").addEventListener("click", handlePlay);
  document.getElementById("queue-btn").addEventListener("click", handleQueue);
  document.getElementById("loop-btn").addEventListener("click", toggleLoop);
  document.getElementById("shuffle-btn").addEventListener("click", toggleShuffle);
  document.getElementById("rain-btn").addEventListener("click", toggleRain);
  document.getElementById("rain-vol").addEventListener("input", handleRainVolume);
  document.getElementById("restart-btn").addEventListener("click", handleRestart);
  document.getElementById("next-btn").addEventListener("click", handleNext);
  document.getElementById("set-range-btn").addEventListener("click", handleSetRange);
  document.getElementById("clear-range-btn").addEventListener("click", handleClearRange);
  document.getElementById("share-btn").addEventListener("click", handleShare);
  document.getElementById("clear-all-btn").addEventListener("click", handleClearAll);
  document.getElementById("url-input").addEventListener("keydown", function (e) {
    if (e.key === "Enter") handlePlay();
  });

  // Auto-resume rain on first user interaction if it was saved as ON
  if (rainOn) {
    var resumeRain = function () {
      startRain();
      document.removeEventListener("click", resumeRain);
      document.removeEventListener("keydown", resumeRain);
    };
    document.addEventListener("click", resumeRain, { once: false });
    document.addEventListener("keydown", resumeRain, { once: false });
  }

  syncQueueHeight();
  initDragListeners();

})();
