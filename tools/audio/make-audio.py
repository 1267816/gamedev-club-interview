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
BGM_DUR = 20.0          # 秒(循环长度)
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


def make_key():
    n = int(KEY_DUR * SR)
    t = np.arange(n) / SR
    # 咔:极短的噪声爆 + 一个高音 tick
    rng = np.random.default_rng(7)
    noise = rng.normal(0, 1, n) * np.exp(-t / 0.004)
    tick = np.sin(2 * math.pi * KEY_TICK_HZ * t) * np.exp(-t / 0.012)
    sig = KEY_NOISE * noise + (1 - KEY_NOISE) * tick
    sig *= np.clip(t / 0.0015, 0, 1)          # 极小淡入,避免爆音
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
    n = int(BGM_DUR * SR)
    t = np.arange(n) / SR
    sig = np.zeros(n)

    # ① 低频铺底:两个相差五度的正弦 + 很慢的呼吸
    breath = 0.75 + 0.25 * np.sin(2 * math.pi * t / BGM_DUR)      # 整段一个周期 → 循环点连续
    sig += 0.30 * np.sin(2 * math.pi * BGM_ROOT * t) * breath
    sig += 0.20 * np.sin(2 * math.pi * BGM_ROOT * 1.5 * t) * breath

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

    # ③ 稀疏铃音:每 3.3 秒一颗,像远处仪表在响
    rng = np.random.default_rng(11)
    for k in range(int(BGM_DUR / 3.3)):
        st = int((k * 3.3 + 0.6) * SR)
        m = min(n - st, int(1.6 * SR))
        if m <= 0:
            continue
        tt = np.arange(m) / SR
        semi = int(rng.integers(0, 5)) * 2
        f = BGM_ROOT * 16 * (2 ** (semi / 12.0))
        bell = np.sin(2 * math.pi * f * tt) * _env(m, attack=0.005, release=0.45)
        sig[st:st + m] += 0.05 * bell

    # ④ 收尾:整段两端做等功率交叉淡化,把尾巴叠到头上 → 循环无缝
    fade = int(1.0 * SR)
    head, tail = sig[:fade].copy(), sig[-fade:].copy()
    x = np.linspace(0, 1, fade)
    sig[:fade] = head * x + tail * (1 - x)
    sig = sig[:n - fade]                                          # 去掉重复的尾巴
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
    items = [("key.wav", make_key()), ("notify.wav", make_notify()), ("bgm.wav", make_bgm())]
    for name, sig in items:
        size = write_wav(os.path.join(out, name), sig)
        print("生成 %-11s %6.1f KB" % (name, size / 1024.0))


if __name__ == "__main__":
    main()
