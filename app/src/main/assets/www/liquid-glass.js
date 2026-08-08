/* ════════════════════════════════════════════════════════
   LIQUID GLASS LAYER (SYNC 리디자인 — 순수 추가 스크립트)
   - app.js 의 재생/검색/AndroidBridge 로직은 전혀 건드리지 않음.
   - 1) 검색 캡슐 / 하단 내비 캡슐의 SVG 굴절(displacement) 맵 생성
   - 2) 하단 내비 "Morphing Sliding Pill" 인디케이터 애니메이션
   참고 원리: convex squircle 표면 → 법선 → Snell 굴절 →
   R/G 채널에 정규화된 변위 벡터를 기록한 feImage → feDisplacementMap
   (Liquid_glass_kit.js 의 refractionProfile/makeMap 로직을 그대로 재사용)
════════════════════════════════════════════════════════ */
(function () {
    "use strict";

    const $ = (s, ctx) => (ctx || document).querySelector(s);

    /* ---------- 1. 굴절 맵 생성 (kit과 동일한 수학) ---------- */
    const convexSquircle = x => Math.pow(Math.max(0, 1 - Math.pow(1 - x, 4)), .25);

    function refractionProfile(bezel, thickness, n1, n2, samples) {
        bezel = bezel || 30; thickness = thickness || 1.0;
        n1 = n1 || 1; n2 = n2 || 1.5; samples = samples || 127;
        const out = [];
        let max = 0;
        for (let i = 0; i < samples; i++) {
            const x = i / (samples - 1);
            const d = .001;
            const y1 = convexSquircle(Math.max(0, x - d));
            const y2 = convexSquircle(Math.min(1, x + d));
            const slope = (y2 - y1) / (Math.min(1, x + d) - Math.max(0, x - d) || 1);
            const nx = -slope, ny = 1;
            const len = Math.hypot(nx, ny) || 1;
            const ux = nx / len, uy = ny / len;
            const cosI = Math.max(-1, Math.min(1, uy));
            const sinI = Math.sqrt(Math.max(0, 1 - cosI * cosI));
            const ratio = n1 / n2;
            const sinT = Math.min(.999999, ratio * sinI);
            const cosT = Math.sqrt(Math.max(0, 1 - sinT * sinT));
            const tx = uy, ty = -ux;
            const sign = ux >= 0 ? 1 : -1;
            const rx = sign * sinT * tx + cosT * ux;
            const ry = sign * sinT * ty + cosT * uy;
            const dx = rx / Math.max(.05, Math.abs(ry)) * thickness;
            const mag = Math.abs(dx) * bezel * .18;
            out.push({ x: x, mag: mag });
            max = Math.max(max, mag);
        }
        return { out: out, max: max };
    }

    function makeMap(w, h, bezel) {
        const dpr = Math.min(devicePixelRatio || 1, 2);
        const mw = Math.max(96, Math.min(384, Math.round(w * dpr / 2)));
        const mh = Math.max(48, Math.min(160, Math.round(h * dpr / 2)));
        const c = document.createElement("canvas");
        c.width = mw; c.height = mh;
        const ctx = c.getContext("2d");
        const data = ctx.createImageData(mw, mh);
        const profile = refractionProfile(bezel, 1);
        const maxMag = profile.max || 1;
        const px = t => profile.out[Math.max(0, Math.min(126, Math.round(t * 126)))].mag / maxMag;

        let k = 0;
        for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) {
            const X = (x + .5) / mw * w, Y = (y + .5) / mh * h;
            const dl = X, dr = w - X, dt = Y, db = h - Y;
            const minX = Math.min(dl, dr), minY = Math.min(dt, db);
            const edge = Math.min(minX, minY);
            const t = Math.max(0, Math.min(1, edge / bezel));
            const m = px(t);

            let vx = 0, vy = 0;
            if (Math.abs(minX - minY) < bezel * .72) {
                const sx = dl <= dr ? 1 : -1, sy = dt <= db ? 1 : -1;
                const ax = Math.max(.001, 1 - minX / Math.max(bezel, .001));
                const ay = Math.max(.001, 1 - minY / Math.max(bezel, .001));
                const len = Math.hypot(ax, ay) || 1;
                vx = sx * (ax / len) * m;
                vy = sy * (ay / len) * m;
            } else if (minX < minY) {
                vx = (dl <= dr ? 1 : -1) * m;
            } else {
                vy = (dt <= db ? 1 : -1) * m;
            }

            data.data[k++] = 128 + Math.round(vx * 127);
            data.data[k++] = 128 + Math.round(vy * 127);
            data.data[k++] = 128;
            data.data[k++] = 255;
        }
        ctx.putImageData(data, 0, 0);
        return { url: c.toDataURL("image/png"), scale: Math.max(8, Math.min(46, maxMag)) };
    }

    function applyGlassTo(el, mapId, refractionId, bezel, boost) {
        if (!el) return;
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) return;
        const image = $(mapId);
        const refraction = $(refractionId);
        if (!image || !refraction) return;
        const capRatio = el && el.id === "mnPill" ? .85 : .46;
        const map = makeMap(r.width, r.height, Math.min(bezel, r.height * capRatio));
        image.setAttribute("href", map.url);
        image.setAttribute("width", r.width);
        image.setAttribute("height", r.height);
        image.setAttribute("x", 0); image.setAttribute("y", 0);
        // 과도한 boost가 요소 자체 높이를 넘는 변위를 만들면 displacement가
        // 배경 밖을 샘플링해 굴절이 통째로 사라지므로(투명해짐), 요소 크기에
        // 비례한 상한을 둔다.
        const rawScale = map.scale * (boost || 1);
        const finalScale = Math.min(rawScale, r.height * .58, 60);
        refraction.setAttribute("scale", finalScale.toFixed(2));
    }

    function visibleSearchWrap() {
        // 현재 활성 view(.view.on) 안의 검색 캡슐만 계산 (숨겨진 요소는 rect가 0이라 스킵됨)
        return document.querySelector(".view.on .mob-srch-wrap");
    }

    function applyAllGlass() {
        applyGlassTo(visibleSearchWrap(), "#searchDisplacementMap", "#searchGlassRefraction", 28);
        applyGlassTo(document.getElementById("mob-nav"), "#navDisplacementMap", "#navGlassRefraction", 30);
        const bar = document.getElementById("bar");
        if (bar && !bar.classList.contains("bar-hidden")) {
            applyGlassTo(bar, "#barDisplacementMap", "#barGlassRefraction", 32);
        }
        // 작은 캡슐(필)은 가장자리 굴절을 훨씬 강하고 넓게 (bezel↑, boost 3.2배)
        applyGlassTo(document.getElementById("mnPill"), "#pillDisplacementMap", "#pillGlassRefraction", 40, 2.4);
    }

    /* 재생이 시작되어 미니 플레이어 바(#bar)가 'bar-hidden'을 벗고 나타날 때
       굴절 맵을 다시 계산한다. app.js 로직은 건드리지 않고 클래스 변화만 관찰. */
    function watchBarVisibility() {
        const bar = document.getElementById("bar");
        if (!bar) { setTimeout(watchBarVisibility, 100); return; }
        const mo = new MutationObserver(() => {
            if (!bar.classList.contains("bar-hidden")) {
                setTimeout(() => applyGlassTo(bar, "#barDisplacementMap", "#barGlassRefraction", 32), 50);
            }
        });
        mo.observe(bar, { attributes: true, attributeFilter: ["class"] });
    }

    let resizeTimer;
    addEventListener("resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(applyAllGlass, 160); });

    /* ---------- 2. 하단 내비 Morphing Sliding Pill ---------- */
    function morphPillTo(view) {
        const nav = document.getElementById("mob-nav");
        const pill = document.getElementById("mnPill");
        const btn = nav && nav.querySelector('.mn-btn[data-v="' + view + '"]');
        if (!nav || !pill || !btn) return;

        const navR = nav.getBoundingClientRect();
        const btnR = btn.getBoundingClientRect();
        // 필 여백을 6px→3px로 줄여 캡슐 크기를 더 키움
        const targetLeft = Math.round(btnR.left - navR.left + 3);
        const targetWidth = Math.round(btnR.width - 6);
        const prev = pill._rect;

        if (!prev) {
            // 최초 배치: 애니메이션 없이 바로 위치
            pill.style.transition = "none";
            pill.style.left = targetLeft + "px";
            pill.style.width = targetWidth + "px";
            // 강제 리플로우 후 트랜지션 복구
            void pill.offsetWidth;
            pill.style.transition = "";
        } else if (prev.left !== targetLeft) {
            // 1단계: 이전 위치 ↔ 새 위치를 한번에 덮는 "블롭" 형태로 빠르게 늘어남
            const stretchLeft = Math.min(prev.left, targetLeft);
            const stretchRight = Math.max(prev.left + prev.width, targetLeft + targetWidth);
            pill.style.transitionProperty = "left, width";
            pill.style.transitionDuration = ".15s";
            pill.style.transitionTimingFunction = "cubic-bezier(.3,.9,.4,1)";
            pill.style.left = stretchLeft + "px";
            pill.style.width = (stretchRight - stretchLeft) + "px";

            clearTimeout(pill._morphTimer);
            pill._morphTimer = setTimeout(() => {
                // 2단계: 목표 버튼 크기로 튕기며 정착 (overshoot easing)
                pill.style.transitionDuration = ".48s";
                pill.style.transitionTimingFunction = "cubic-bezier(.22,1.61,.36,1)";
                pill.style.left = targetLeft + "px";
                pill.style.width = targetWidth + "px";
            }, 150);
        }
        pill._rect = { left: targetLeft, width: targetWidth };
    }

    function currentActiveView() {
        const on = document.querySelector(".mn-btn.on");
        return on ? on.dataset.v : "home";
    }

    function initPill() {
        morphPillTo(currentActiveView());
    }

    /* 필의 자체 굴절 맵은 크기가 바뀔 때만 다시 계산하면 충분하다
       (5개 버튼은 flex:1 이라 목표 폭이 거의 동일 — 정착 시점에 한 번씩만 갱신). */
    function watchPillGlass() {
        const pill = document.getElementById("mnPill");
        if (!pill) return;
        pill.addEventListener("transitionend", e => {
            if (e.propertyName === "width") {
                applyGlassTo(pill, "#pillDisplacementMap", "#pillGlassRefraction", 40, 2.4);
            }
        });
    }

    /* gv()는 app.js에서 정의됨 — 원본 로직은 그대로 호출하고,
       뷰가 바뀐 뒤에 필 애니메이션 + 새 화면의 글래스 굴절 맵만 추가로 갱신한다. */
    function wireNavHook() {
        if (typeof window.gv !== "function") {
            setTimeout(wireNavHook, 50);
            return;
        }
        const originalGv = window.gv;
        window.gv = function (v, el) {
            originalGv(v, el);
            morphPillTo(v);
            setTimeout(applyAllGlass, 60);
        };
    }

    function boot() {
        initPill();
        applyAllGlass();
        wireNavHook();
        watchPillGlass();
        watchBarVisibility();
        setTimeout(applyAllGlass, 350); // 폰트/이미지 로드 이후 재계산
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", boot);
    } else {
        boot();
    }
})();
