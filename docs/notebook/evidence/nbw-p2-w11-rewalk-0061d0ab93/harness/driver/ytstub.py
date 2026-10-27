"""A YouTube IFrame API stand-in (the vendor iframe is the one thing the sandbox cannot serve; the product's own
GlobalVideoLayer, its store, controls, inert marker and drag code all run unchanged). Installed with
context.add_init_script before any page script, so useYouTubeApi sees window.YT.Player and never loads
youtube.com. The fake reports PLAYING after playVideo() and PAUSED after pauseVideo(), and counts calls in
window.__ytCalls so a step can read what the product's buttons did."""

YT_STUB = r"""
(() => {
  const calls = window.__ytCalls = [];
  const S = { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 };
  class Player {
    constructor(el, opts) {
      this._opts = opts || {}; this._t = 0; this._state = S.UNSTARTED; this._rate = 1; this._muted = false; this._vol = 100;
      const host = typeof el === 'string' ? document.getElementById(el) : el;
      const f = document.createElement('iframe'); f.setAttribute('data-yt-stub', '1'); f.title = 'video';
      f.style.cssText = 'width:100%;height:100%;border:0;background:#111';
      if (host) { host.innerHTML = ''; host.appendChild(f) }
      this._iframe = f;
      setTimeout(() => { const ev = this._opts.events || {}; ev.onReady && ev.onReady({ target: this });
        if ((this._opts.playerVars || {}).autoplay) this.playVideo() }, 50);
      this._tick = setInterval(() => { if (this._state === S.PLAYING) this._t += 0.25 * this._rate }, 250);
    }
    _set(s) { this._state = s; calls.push('state:' + s); const ev = this._opts.events || {}; ev.onStateChange && ev.onStateChange({ target: this, data: s }) }
    playVideo() { calls.push('play'); this._set(S.PLAYING) }
    pauseVideo() { calls.push('pause'); this._set(S.PAUSED) }
    stopVideo() { calls.push('stop'); this._set(S.ENDED) }
    seekTo(t) { calls.push('seek:' + t); this._t = t }
    loadVideoById(o) { calls.push('load'); this._t = (o && o.startSeconds) || 0; this._set(S.PLAYING) }
    cueVideoById() { calls.push('cue'); this._set(S.CUED) }
    getCurrentTime() { return this._t } getDuration() { return 600 } getPlayerState() { return this._state }
    getPlaybackRate() { return this._rate } setPlaybackRate(r) { this._rate = r }
    mute() { this._muted = true } unMute() { this._muted = false } isMuted() { return this._muted }
    setVolume(v) { this._vol = v } getVolume() { return this._vol }
    getIframe() { return this._iframe } getVideoData() { return { video_id: 'stub', title: 'stub' } }
    loadModule() {} unloadModule() {} setOption() {} getOption() { return null }
    addEventListener() {} removeEventListener() {}
    destroy() { calls.push('destroy'); clearInterval(this._tick); this._iframe && this._iframe.remove() }
  }
  window.YT = { Player, PlayerState: S, loaded: 1 };
})();
"""
