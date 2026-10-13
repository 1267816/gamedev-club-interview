#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
tools/audio/make-audio.py —— 生成《星海漫游》的三个音频素材

**这不是游戏的一部分**:浏览器不加载它,index.html 也不需要它。
它的作用是"把音频也变成可复现的东西" —— 素材是**合成**出来的,
所以没有第三方授权问题、体积极小、离线可播,而且想改音色只要改参数重跑:

    python tools/audio/make-audio.py

产物(写进 assets/audio/):
    key.wav     打字机按键声(很短,每敲一个字放一次)
    notify.wav  重要信息提示音(成就 / 重要消息,一声清脆的铃)
    bgm.wav     背景音乐(20 秒无缝循环:低频铺底 + 缓慢和弦 + 稀疏铃音)

依赖:numpy(只用标准库 wave 写文件)
参数集中在本文件顶部,方便调音色;改完重跑即可。
"""
import math
import os
import wave

import numpy as np

SR = 22050              # 采样率(够用又小)

# ---- 打字机按键声 ----
KEY_DUR = 0.055         # 秒
KEY_TICK_HZ = 2100.0    # "咔"的那一声
KEY_NOISE = 0.35        # 噪声成分(机械感)

# ---- 重要信息提示音 ----
NOTIFY_DUR = 1.25
NOTIFY_HZ = [880.0, 1108.73]   # A5 + C#6(大三度,听起来"顺")

# ---- 背景音乐 ----
BGM_DUR = 40.0          # 秒(循环长度;V0.2.7:20 → 40,重复感更低)
BGM_ROOT = 55.0         # A1:低频铺底
# 四个和弦(半音偏移),每个 5 秒 —— Am → F → C → G,小调偏"太空"
BGM_CHORDS = [
    [0, 3, 7],          # A 小
    [-4, 0, 5],         # F 大
    [3, 7, 10],         # C 大
    [-2, 2, 5],         # G 大
]


def _env(n, attack=0.01, release=0.5, total=None):
    """简单包络:前 attack 淡入,后面指数衰减。"""
    total = total or n
    t = np.arange(n) / SR
    a = np.clip(t / max(attack, 1e-6), 0, 1)
    d = np.exp(-t / max(release, 1e-6))
    return a * d


def env(n, attack=0.01, decay=0.5):
    """(别名)_env 的简写,decay 就是 _env 的 release。"""
    return _env(n, attack=attack, release=decay)


def place(dst, src, at):
    """把 src 叠加到 dst 的 at 秒处,超出末尾就截断(放在尾部才不会报形状不匹配)。"""
    i = int(at * SR)
    if i >= len(dst) or i < 0:
        return
    m = min(len(src), len(dst) - i)
    dst[i:i + m] += src[:m]


def lowpass(x, cutoff=2000.0):
    """一阶低通:把生硬的噪声磨圆(按键声用 —— 太尖听久了刺耳)。"""
    a = math.exp(-2 * math.pi * cutoff / SR)
    y = np.zeros_like(x)
    acc = 0.0
    for i in range(len(x)):
        acc = (1 - a) * x[i] + a * acc
        y[i] = acc
    return y


def make_key():
    # V0.2.7:整体调柔 —— 去掉尖锐的高频噪声,主频降下来,淡入拉长
    n = int(KEY_DUR * SR)
    t = np.arange(n) / SR
    rng = np.random.default_rng(3)
    noise = lowpass(rng.normal(0, 1, n), cutoff=1700.0) * env(n, attack=0.004, decay=0.010)
    body = np.sin(2 * math.pi * 700 * t) * env(n, attack=0.003, decay=0.020)
    air = np.sin(2 * math.pi * 2600 * t) * env(n, attack=0.002, decay=0.005)
    sig = 0.55 * noise + 0.85 * body + 0.12 * air
    sig *= np.clip(t / 0.004, 0, 1)
    return sig


def make_notify():
    n = int(NOTIFY_DUR * SR)
    t = np.arange(n) / SR
    sig = np.zeros(n)
    for i, f in enumerate(NOTIFY_HZ):
        # 两个音错开一点点起音,像"叮—铃"
        delay = 0.0 if i == 0 else 0.06
        start = int(delay * SR)
        m = n - start
        tt = t[:m]
        partial = (np.sin(2 * math.pi * f * tt)
                   + 0.22 * np.sin(2 * math.pi * f * 2 * tt)      # 泛音,铃味
                   + 0.08 * np.sin(2 * math.pi * f * 3.01 * tt))
        partial *= _env(m, attack=0.004, release=0.34)
        sig[start:] += partial
    # 一点点"余响":把信号推迟并衰减几次叠上去,给点空间感
    out = sig.copy()
    for d, g in ((0.09, 0.28), (0.18, 0.16), (0.30, 0.08)):
        k = int(d * SR)
        out[k:] += sig[:len(sig) - k] * g
    return out


def make_bgm():
    # V0.2.7:原来只有"铺底 + 和弦 + 铃",听两分钟就腻。这一版加了:
    # 一条稀疏的长音旋律(五声音阶)、每 10 秒一下的低音鼓点、更长的循环(20 → 40 秒)
    n = int(BGM_DUR * SR)
    t = np.arange(n) / SR
    sig = np.zeros(n)

    # ① 低频铺底:两个相差五度的正弦 + 很慢的呼吸
    breath = 0.72 + 0.28 * np.sin(2 * math.pi * t / BGM_DUR - math.pi / 2)   # 整段一个周期 → 循环点连续
    sig += 0.26 * np.sin(2 * math.pi * BGM_ROOT * t) * breath
    sig += 0.17 * np.sin(2 * math.pi * BGM_ROOT * 1.5 * t) * breath

    # ② 和弦铺底:每段 5 秒一个和弦,首尾交叉淡入淡出 → 边界不爆音
    seg = BGM_DUR / len(BGM_CHORDS)
    for ci, chord in enumerate(BGM_CHORDS):
        t0 = ci * seg
        for semi in chord:
            f = BGM_ROOT * 8 * (2 ** (semi / 12.0))               # 抬高两个八度,当 pad
            ph = 2 * math.pi * f * (t - t0)
            note = np.sin(ph) + 0.3 * np.sin(2 * ph)
            w = np.zeros(n)
            a = int(t0 * SR)
            b = int(min(n, (t0 + seg) * SR))
            if b > a:
                ramp = np.ones(b - a)
                fade = int(0.8 * SR)                              # 每段两头各淡 0.8 秒
                k = min(fade, (b - a) // 2)
                if k > 0:
                    ramp[:k] = np.linspace(0, 1, k)
                    ramp[-k:] = np.linspace(1, 0, k)
                w[a:b] = ramp
            sig += 0.055 * note * w

    # ③ 稀疏旋律:A 小调五声,长音 + 轻微颤音 —— 让 40 秒不单调(V0.2.7 新增)
    pent = [0, 3, 5, 7, 10, 12, 10, 7, 5, 3, 0, -2, 0, 3, 5]
    for i, s in enumerate(pent):
        at = 1.2 + i * 2.5
        if at > BGM_DUR - 2:
            break
        m = int(3.0 * SR)
        tt = np.arange(m) / SR
        f = BGM_ROOT * 8 * (2 ** (s / 12.0))
        vib = 1.0 + 0.004 * np.sin(2 * math.pi * 4.5 * tt)
        note = (np.sin(2 * math.pi * f * tt * vib)
                + 0.16 * np.sin(2 * math.pi * f * 2 * tt)) * _env(m, attack=0.35, release=1.5)
        place(sig, note * 0.075, at)

    # ④ 低音鼓点:每 10 秒一下,像很远的心跳(V0.2.7 新增)
    for k in range(int(BGM_DUR / 10)):
        m = int(1.2 * SR)
        tt = np.arange(m) / SR
        boom = np.sin(2 * math.pi * (44.0 * np.exp(-tt / 0.12)) * tt) * _env(m, attack=0.005, release=0.30)
        place(sig, boom * 0.22, k * 10.0)

    # ⑤ 稀疏铃音:每 3.3 秒一颗,像远处仪表在响
    rng = np.random.default_rng(11)
    for k in range(int(BGM_DUR / 3.3)):
        st = int((k * 3.3 + 0.6) * SR)
        m = min(n - st, int(1.6 * SR))
        if m <= 0:
            continue
        tt = np.arange(m) / SR
        step = int(rng.integers(0, 5)) * 2
        f = BGM_ROOT * 16 * (2 ** (step / 12.0))
        bell = np.sin(2 * math.pi * f * tt) * _env(m, attack=0.005, release=0.45)
        place(sig, bell * 0.045, (k * 3.3 + 0.6))

    # ⑥ 收尾:整段两端做等功率交叉淡化,把尾巴叠到头上 → 循环无缝
    fade = int(1.5 * SR)
    head, tail = sig[:fade].copy(), sig[-fade:].copy()
    x = np.linspace(0, 1, fade)
    sig[:fade] = head * x + tail * (1 - x)
    sig = sig[:n - fade]                                          # 去掉重复的尾巴
    return sig


# ---------- 结局音乐(V0.2.7 新增:要"震撼") ----------
ENDING_DUR = 32.0


def make_ending():
    n = int(ENDING_DUR * SR)
    t = np.arange(n) / SR
    sig = np.zeros(n)

    # ① 深潜的铺底:A0 + A1
    sig += 0.30 * np.sin(2 * math.pi * 27.5 * t)
    sig += 0.20 * np.sin(2 * math.pi * 55.0 * t)

    # ② 五段和弦一路往上推:越到后面越亮、越响
    chords = [[0, 3, 7], [-4, 0, 5], [3, 7, 10], [-2, 2, 5], [0, 4, 7, 12]]
    seg = ENDING_DUR / len(chords)
    for ci, ch in enumerate(chords):
        grow = 0.35 + 0.75 * (ci / (len(chords) - 1))
        freqs = [BGM_ROOT * 2 * (2 ** (s / 12.0)) for s in ch] + [BGM_ROOT * 4 * (2 ** (s / 12.0)) for s in ch[:2]]
        m = int((seg + 1.6) * SR)
        note = np.zeros(m)
        for f in freqs:
            note += np.sin(2 * math.pi * f * (np.arange(m) / SR)) + 0.22 * np.sin(2 * math.pi * f * 2 * (np.arange(m) / SR))
        note = note / max(len(freqs), 1) * _env(m, attack=2.2, release=7.0) * (0.085 * grow)
        place(sig, note, ci * seg)

    # ③ 上行旋律:每 2.4 秒一级,最后停在主音
    climb = [0, 3, 5, 7, 10, 12, 15, 12, 7, 12, 12]
    for i, s in enumerate(climb):
        at = 1.5 + i * 2.4
        if at > ENDING_DUR - 3:
            break
        m = int(3.2 * SR)
        tt = np.arange(m) / SR
        f = BGM_ROOT * 8 * (2 ** (s / 12.0))
        note = np.sin(2 * math.pi * f * tt) + 0.20 * np.sin(2 * math.pi * f * 2 * tt)
        place(sig, note * _env(m, attack=0.5, release=1.4) * (0.09 + 0.012 * i), at)

    # ④ 高潮的钟声
    for at, f in ((22.0, 1760.0), (27.0, 880.0)):
        m = int(3.0 * SR)
        tt = np.arange(m) / SR
        bell = np.sin(2 * math.pi * f * tt) + 0.3 * np.sin(2 * math.pi * f * 2.01 * tt)
        place(sig, bell * _env(m, attack=0.004, release=1.1) * 0.16, at)

    # ⑤ 结尾渐弱到静音、开头也淡入 → 循环不爆音
    tail = int(3.0 * SR)
    sig[-tail:] *= np.linspace(1, 0, tail)
    head = int(0.6 * SR)
    sig[:head] *= np.linspace(0, 1, head)
    return sig


def write_wav(path, sig, peak=0.85):
    sig = np.asarray(sig, dtype=np.float64)
    m = float(np.max(np.abs(sig))) or 1.0
    sig = sig / m * peak
    data = np.clip(sig * 32767, -32768, 32767).astype("<i2")
    with wave.open(path, "wb") as f:
        f.setnchannels(1)
        f.setsampwidth(2)
        f.setframerate(SR)
        f.writeframes(data.tobytes())
    return len(data) * 2


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    out = os.path.normpath(os.path.join(here, "..", "..", "assets", "audio"))
    os.makedirs(out, exist_ok=True)
    items = [("key.wav", make_key()), ("notify.wav", make_notify()),
             ("bgm.wav", make_bgm()), ("ending.wav", make_ending())]
    for name, sig in items:
        size = write_wav(os.path.join(out, name), sig)
        print("生成 %-11s %6.1f KB" % (name, size / 1024.0))


if __name__ == "__main__":
    main()
