# ciap 架构（Android 首发 / iOS 设计内建）

> 范围：济南市辖区（adcode 370100）单城首发；首版 Android，iOS 从第一天参与设计。Web 原型只做 UX/视觉验证。
> 硬约束：Android PSS ≤ 200MB（目标 ≤ 180MB，iOS footprint 同级）；全栈禁用 Python；坐标全链路 GCJ-02。
> 不写 SDK 版本号，接入版本以官方文档与仓库锁定的依赖清单为准。

## 0. 结论

1. **原生 UI + 共享 C17 内核**：Kotlin + Jetpack Compose、SwiftUI；地图/定位用高德两端原生 SDK；跨端领域逻辑（几何、路线、进度、格式化、缓存、城市配置、排序）收敛到约 4k 行 C17，经 JNI（Android）与 ObjC++ 桥（iOS）暴露。
2. **不用 Flutter / RN / KMP 运行时**：200MB 的敌人是"多一套渲染/脚本运行时 + 地图只能 PlatformView 混排"带来的双份纹理与对象图；iOS 侧也必须以 SwiftUI + AMap iOS SDK 为一等公民。
3. **单地图实例**：全进程同一时刻只有一个地图引擎实例，浏览态与导航态互斥切换——内存预算成立的前提。
4. **路线/搜索走自有 BFF 归一化**（Node.js，与 fixture 同栈），客户端只拿 `SearchResult`/`RoutePlan`；Web Service key 不进客户端。
5. 数据契约以原型 `window.CIAP_FIXTURES` 为种子演化（§2 数据契约），P1 起由 BFF 生产同一形状。

## 1. 架构决策：原生 UI + C 内核

| 方案 | 额外运行时/内存 | iOS 适配 | 判断 |
|---|---|---|---|
| 原生 UI + C 内核 | C 内核 < 1MB，无 GC/脚本引擎 | SwiftUI、AMap iOS SDK、无障碍/语音/省电直通 | ✅ 采用 |
| Flutter | Dart VM + 自带渲染引擎；地图只能 PlatformView 混排，多一层纹理与引用 | 插件滞后，非一等公民 | ❌ 内存、Apple 支持双输 |
| React Native | JS 引擎 + bridge；地图同样 PlatformView | 中 | ❌ 双层渲染、启动更慢 |
| KMP 共享 UI | Compose Multiplatform iOS 靠互操作；地图仍 PlatformView | 中 | ❌ 不省地图内存，只多一层 |

预算大头是高德引擎（不可替换），能省的只有引擎之外：一套 UI 工具链、一个极小领域内核、极少图片资产、无统计/无 WebView。原生方案只有一条渲染管线（Compose/SwiftUI）+ 地图 SDK 自己的 GL 纹理；C 内核不参与渲染、零初始化、常驻 < 1MB。启动同理：C 零预热，主要成本就是 AMap 初始化，只能靠"延后 + 首帧后异步"。

**职责边界**：C 负责 haversine/方位角、GCJ-02 转换（唯一入口）、折线编解码与 Douglas-Peucker 简化、`RoutePlan` 解析、step 索引、进度/maneuver 状态机、偏航判定、距离/时长/ETA 中文格式化、定容字节 LRU、城市配置与 bbox 校验、搜索排序融合。平台层负责网络/鉴权/重试、地图渲染与相机/手势/样式加载、权限、定位回调、TTS、持久化、通知、无障碍、生命周期与内存警告。**理由**：两端需要逐字节一致的逻辑（进度、偏航、格式化、排序）用 C + CTest 可秒级回归；平台能力（渲染/定位/权限）在 C 里重写只会产生双份实现与合规风险。

**C 内核模块**（`core/include/ciap/`）：

| 模块 | 职责 | 约束 |
|---|---|---|
| `geo` | haversine、方位角、球面插值、GCJ-02/WGS84 转换 | 双精度纯函数；坐标转换只在此处 |
| `polyline` | `"lng,lat;lng,lat"` 编解码、DP 简化、累计里程 | 写调用方 arena，零 malloc；误差 ≤ 5m |
| `route` | RoutePlan/option、step 表、进度与 maneuver 状态机、偏航 | O(1) 增量推进，不随折线增长回溯 |
| `fmt` | 米/公里、分钟/小时、ETA 时刻、中文单位 | 固定缓冲、手写数字转换，不依赖 printf locale |
| `cache` | 字节计容 LRU（路线/搜索） | 淘汰不回调平台；可一键清空 |
| `city` | 城市配置、bbox 点包含、adcode、热门 POI 表 | 只读表，平台传入配置字节后解析 |
| `rank` | 候选融合排序（距离/前缀/类别/热门加权） | 确定性，可快照测试 |
| `json`/`arena` | 最小 JSON 解析 + bump arena | 解析非热路径；输出指针全指向 arena |

## 2. 模块地图与数据流

```
Compose Screen / SwiftUI Screen（只吃 UiState，只发 Intent）
   │ Intent                      ▲ UiState
   ▼                             │
ViewModel（viewModelScope / @MainActor @Observable，单向数据流）
   ▼
Repository（编排 + 缓存策略 + 错误映射）
   ├── SearchRepo ── BffClient ──► BFF ──► 高德 Web：Input Tips / Place Text
   ├── RouteRepo  ── BffClient ──► BFF ──► 高德 Web：driving v3 / walking v3 / bicycling v4 / transit integrated v3
   ├── MapBridge  ──► AMap 地图 SDK（TextureMapView / MAMapView，主线程，单实例）
   ├── LocationBridge ──► AMap 定位 SDK（GCJ-02）
   └── DomainCore ──► C 内核（解析、排序、简化、进度、格式化；worker 线程）
```

| 功能 | 数据流 | 状态归属 |
|---|---|---|
| 地点搜索 | 输入 → 250ms 防抖 → `GET /v1/search?q=&bbox=` → BFF 加 `citylimit` 并归一化 → C `rank` → 列表 | ViewModel；查询/结果进 C LRU |
| 路线规划 | 选点 → `POST /v1/route`（单模式串行）→ RoutePlan → C 简化+校验 → 画线 + 摘要卡 | 只留当前 mode 的 selected option |
| 路线预览 | 手势/切方案 → 命中 LRU 立即出图，否则请求；相机移动在平台层 | MapBridge，相机不进 C |
| 导航引导 | 定位 1Hz → C `route_progress`（剩余/下一 maneuver/偏航）→ HUD + 相机跟车 + TTS | C 持有导航会话句柄 |

**数据契约（fixture → 生产，只加不改，`schemaVersion` 递增）**

```ts
// BFF 输出、C 内核消费；LngLat = [lng, lat]，全程 GCJ-02
CityConfig  = { schemaVersion, id, adcode, name, center: [lng,lat],
                bounds: [[minLng,minLat],[maxLng,maxLat]], zoom: {min,max}, hotPois: string[] }
SearchResult= { schemaVersion, city, items: [{ id, name, address?, category, lng, lat, distanceM? }] }
RoutePlan   = { schemaVersion, city, mode: 'driving'|'walking'|'bicycling'|'transit',
                origin, destination, options: RouteOption[], etag }
RouteOption = { id, distanceM, durationS, polyline: LngLat[], steps: Step[],
                tollM?, trafficLights?, segments?: TransitSegment[] }
Step        = { index, instruction, action, roadName, distanceM, durationS, polylineRange: [start,end] }
```

原型映射：`options[].distance → distanceM`、`duration → durationS`、`polyline` 原样、`steps/segments` 保留并补 `polylineRange` 供状态机切片；C 内核里的结构体名 `RouteModel` 与 BFF 契约 `RoutePlan` 同构（映射写在 `core/include/ciap/route.h`）；BFF 负责所有几何在 GCJ-02 下输出，客户端不做二次纠偏。

## 3. C 内核构建与互操作

```
core/CMakeLists.txt        # 唯一构建入口：C17、-Wall -Wextra -Werror、Release -Os + LTO
core/include/ciap/*.h      # 公开 C API，C99 兼容头
core/src/*.c               # 无 C++、无外部依赖、仅 libc
core/tests/*.c             # CTest：逻辑唯一测试入口
android/app/build.gradle.kts  # externalNativeBuild { cmake { path = "../core/CMakeLists.txt" } }
ios/build-xcframework.sh   # CMake 产静态库 → xcodebuild -create-xcframework（arm64 + 模拟器切片）
```

- **Android**：release 只出 `arm64-v8a`（目标低端机全 64 位，不发 `armeabi-v7a`），debug 加 `x86_64`；一个 Kotlin `object CiapCore` + 一个 `jni/ciap_jni.c`（约 300 行）只做类型转换与生命周期；热路径只传复用 `ByteBuffer.allocateDirect` 与标量；**C 不回调 Java**（无 upcall/线程 attach），导航进度由 Kotlin 1Hz 轮询；所有入口返回 `ciap_status` 整数码，Kotlin 包成 sealed `CiapError`。
- **iOS**：CMake 分别产 `iphoneos-arm64` 与 `iphonesimulator-arm64/x86_64` 静态库 → XCFramework；Swift 经 module map `import CiapCore`；再加薄 `CiapBridge.mm`（ObjC++）把不透明句柄包成带 `NSError **`、nullability 标注、`dealloc` 调 `*_destroy` 的 ObjC 类，SwiftUI 只碰值类型。
- **构建/测试无 Python**：CMakePresets + CTest + Gradle + xcodebuild；fixture 抓取用 Node.js。

```c
typedef struct ciap_route ciap_route;                         /* 不透明句柄 */
ciap_status ciap_route_parse(const uint8_t *json, size_t len, ciap_route **out);
ciap_status ciap_route_progress(ciap_route *r, double lng, double lat, int64_t t_ms, ciap_progress *out);
void        ciap_route_destroy(ciap_route *r);               /* 唯一释放入口 */
```

**内存所有权规则**：① C 不释放调用方内存，调用方只经 `ciap_*_destroy` 释放 C 对象，句柄 `NULL` 即失败；② 字符串 UTF-8 + 显式长度，不依赖 NUL，输出"先问长度、再写缓冲"；③ 热循环零动态分配（arena/栈缓冲，输入输出全由调用方持有）；④ C 无全局可变状态，句柄非线程安全、一功能一句柄；⑤ 无锁、无 IO、无系统调用，崩溃面限于纯计算；⑥ 不跨边界抛异常：C 只返码、JNI 查 `ExceptionCheck`、ObjC 用 `NSError`；⑦ ABI 只承诺 arm64 设备，`-fvisibility=hidden` 只导出 `ciap_*`。

## 4. AMap 接入

| 能力 | Android | iOS | 接入方式 |
|---|---|---|---|
| 地图 | `TextureMapView`/`AMap` | `MAMapView` | 原生 SDK、单实例、自定义样式；不用 WebView/JS |
| 搜索 | BFF → Web 服务 Input Tips + Place Text | 同 | `city=370100`、`citylimit=true`、bbox 约束；降级用原生搜索 SDK（flag） |
| 路线 | BFF → driving v3 / walking v3 / bicycling v4 / transit integrated v3 | 同 | 四模式，一次只请求当前模式，串行 + LRU |
| 定位 | `AMapLocationClient` | `AMapLocationManager` | 隐私同意后按需初始化；输出已是 GCJ-02 |
| 导航 | 自绘引导（P2） | 同 | RoutePlan + 定位 + 系统 TTS；Navi 仅评估 |
| Key | 平台 key 绑包名 + SHA1 | 平台 key 绑 Bundle ID | dev/prod 分环境；Web Service key 只在 BFF，绑出口 IP |

**地图样式**：在高德控制台生成自定义样式（样式 ID + 可选纹理/JSON），两端加载同一套；底图降噪（去无关 POI 图标与文字、道路降饱和、水域青灰、弱化或关 3D 楼块）——既为"通透"也直接减少标注纹理与几何渲染。自绘只叠加折线、端点、方向箭头。已知限制：可调粒度有限、部分元素无法重绘、样式能力可能依赖高德权益，接入前确认。**高德 logo 与版权信息必须常驻且不可被面板/样式遮挡。** 玻璃质感在 UI 层做：静态半透明 + 细描边 + 极轻阴影，大面积实时模糊仅限系统能力（Android 12+ RenderEffect/iOS 原生 blur），低版本回退不透明瓷面。

**导航取舍**：v1 用自绘引导——复用同一地图实例，只加 C 状态机 + 定位，内存/包体低、视觉完全可控；代价是偏航/重规划/路口提示/语音要自建。AMap Navi 能力强（车道级、路口放大图、隧道），但额外一套引擎+地图，且原生 UI 难贴合设计。P2 用 feature flag 做 A/B 评估，不默认引入。

**Key 与 BFF**：每平台每环境独立 key；Android 绑包名+调试/发布 SHA1，iOS 绑 Bundle ID；Web Service key 仅服务端（绑 IP，可轮换），不进客户端/仓库。BFF（Node.js）提供 `/v1/city/:id/config`、`/v1/search`、`/v1/route`，做 citylimit/bbox 校验、归一化、热门路线内存 LRU + `ETag`、gzip、限流；不记录精确位置与明文搜索词。降级顺序：BFF 挂 → 原生搜索/路线 SDK（flag）→ 只读地图 + 明确文案；地图渲染无降级路径。

## 5. 200MB 内存预算（Android PSS）

口径：`adb shell dumpsys meminfo <pkg>` TOTAL PSS，冷启动静置 30s，中端机；设备间 ±15% 正常，估算值 P1 实测校准。

| 项 | 估算 PSS | 上限/说明 |
|---|---|---|
| AMap 地图引擎 + 瓦片/纹理 | 60 | 自定义样式裁 POI；纹理缓存 ≤ 20MB |
| Native 库映射页 | 10 | AMap `.so` + `libciap_core.so` touched pages |
| Compose UI + 绘制 | 32 | Runtime/LayoutNode/字体缓存/GPU 纹理 |
| ART 运行时 + dex code | 30 | R8 全量、baseline profile |
| 应用 Kotlin 堆 | 14 | 搜索结果 ≤ 50 条；路线只留当前 mode |
| C 内核堆 | 10 | arena 1MB + route 0.5MB×2 + LRU ≤ 6MB |
| 字体/图标/矢量资源 | 8 | 无位图 POI、无照片管线 |
| 峰值预留 | 10 | JSON 解析、布局、路线切换 |
| **合计** | **174** | ≤ 180 目标；190 触发降级；200 硬线 |

导航态：自绘引导 ≈ 174 + 进度/定位/TTS 6 ≈ **180**（TTS 走系统进程，不计本 App）。若引入 AMap Navi，则先销毁浏览地图再建 Navi 地图（互斥）：Navi 引擎+地图 78、ART 30、HUD 22、native 10、Kotlin 12、C 8、资源 8、峰值 8 ≈ **176**；切换期允许峰值 ≤ 195。

**手法**：单地图实例 + `TextureMapView`（少一层 Surface 合成）；View 宿主稳定，禁止 Compose 重组/`AndroidView` 工厂反复建图；自定义样式削减标注与楼块，P2 前不加载卫星图/路况；零图片化（POI 列表与标记全矢量/文字，image cache 默认 0）；C LRU 只存当前城当前 session 的简化几何+摘要，退出页面释放；`onTrimMemory(RUNNING_LOW/CRITICAL)` 清 C LRU→清搜索历史内存副本→停预取；Navi 若启用则懒初始化、退出即 destroy；不用 WebView、不接统计/广告 SDK、不开 `largeHeap`，崩溃数据走 Play Console（无 SDK）；R8 + resource shrinking + ABI splits + baseline profile + `extractNativeLibs=false`。体积：arm64 单 ABI 下载 ≤ 25MB（不含 Navi；引入 Navi 预估 +8–15MB，P2 实测后决策）。

**熔断阶梯（kill-switch）**：>170 持续 30s → 清 C LRU 到 4MB、只留当前 mode 路线、取消预取；>180 → 地图降 2D、关楼块/阴影/路况、纹理缓存减半、结果截断 20；>190 → 销毁非活动地图实例、停动画、降级简化线框并提示"已切换轻量地图"；>200 连续两次采样 → 进"安静模式"（仅文本列表 + 单条简化路线 + 关引导地图），本地诊断留存、用户允许时上报 BFF。

**iOS 等价**：`MAMapView` 单实例常驻容器，`UIViewRepresentable` + Coordinator 缓存，视图重绘不重建地图；路线解析/渲染批次包 `autoreleasepool`；`didReceiveMemoryWarning` 清 C LRU、取消预取、释放非当前路线；不缓存地图截图、无图片管线；`VM Tracker`/`Allocations` 与同机型 Android 对齐，内部目标 ≤ 180MB footprint。

## 6. 性能预算

| 指标 | 目标 | 采集 |
|---|---|---|
| 冷启动 → 可交互地图 | p50 ≤ 2.0s，p95 ≤ 2.8s | `adb shell am start -W` + 端内 trace |
| 首屏（splash → 首页可点） | ≤ 500ms | Macrobenchmark / signpost |
| 搜索：输入 → 结果首帧 | p50 ≤ 400ms、p95 ≤ 800ms（含 250ms 防抖）；LRU 命中 ≤ 100ms | 端内埋点 + BFF 耗时 |
| 路线：请求 → 折线首帧 | p50 ≤ 1.2s、p95 ≤ 2.5s；切模式命中 ≤ 120ms | 端内埋点 + 渲染打点 |
| 手势/动画 | 帧 p95 ≤ 16.7ms，掉帧率 ≤ 2%；面板动效 ≤ 220ms | `dumpsys gfxinfo` framestats |
| 导航 | 定位/进度 1Hz；HUD ≤ 2Hz；偏航 ≤ 3s；重规划 ≤ 2s；语音提前 300/150/50m 按速度 | 路测 + 日志回放 |
| 内存 | 浏览 ≤ 180、导航峰值 ≤ 195；30 分钟增长 ≤ 5MB | `dumpsys meminfo` / Instruments |

启动顺序：进程 → 只加载本地城市配置与日志门面（不触 AMap）→ 首启隐私同意门 → AMap 隐私合规接口 → 首页首帧（纯 Compose/SwiftUI，地图容器先放瓷色占位）→ 首帧后异步初始化地图并淡入 → 空闲再预热搜索。**延后**：Navi/TTS、搜索历史持久化、路线预取、离线地图、分享、任何图片管线。

## 7. 济南单城配置

```json
// config/cities/jinan.json（真实坐标由 Node 脚本从行政区划接口生成，仓库不手填猜测值）
{ "schemaVersion": 1, "id": "jinan", "adcode": "370100", "name": "济南市",
  "center": [lng, lat], "bounds": [[minLng, minLat], [maxLng, maxLat]],
  "zoom": { "min": 10, "max": 18 },
  "search": { "citylimit": true, "city": "370100", "bbox": true },
  "route": { "bboxRequired": true }, "hotPois": ["泉城广场", "..."] }
```

搜索/输入提示强制 `citylimit=true`；路线规划 API 无等价开关，由 BFF 用 `bounds` 校验起终点，越界拒绝（文案：暂只支持济南市辖区）。配置随包内置 + 异步远程覆盖（灰度/扩城不改包），BFF 以 adcode 白名单校验。**扩城清单**：① 高德确认城市配额与商用授权；② 生成 `<city>.json`；③ BFF 白名单与缓存分区；④ Node fixture 抓取 + 黄金回归；⑤ 样式按 POI 密度微调；⑥ 远程灰度；⑦ 坐标/地标回归。目标：加城市 = 配置下发 + BFF 白名单，不发版。

## 8. 合规与信任

1. 首启隐私弹层不预勾选，列明高德 SDK（地图/搜索/定位）及用途；拒绝则不初始化任何 SDK，只给退出说明。
2. 用户同意后再调 AMap 隐私合规接口（`updatePrivacyShow/updatePrivacyAgree` 系列，以接入版本文档为准）；**先合规接口、后 SDK 初始化**，顺序写进启动单测。
3. 定位权限在点"定位/导航"时请求，先静态说明再弹系统框；拒绝则手动选起点；不做后台定位。
4. 高德 logo、版权/审图号常驻可视区，自定义样式与玻璃面板不得遮挡。
5. 不自建瓦片缓存/离线包；离线能力只用高德官方离线地图并守其条款。
6. 上线前完成高德商用授权；Web Service key 仅 BFF、绑 IP、可轮换；客户端 key 绑包名/签名。
7. 全链路 HTTPS + 证书校验；BFF 不存精确位置与明文搜索词（脱敏、短留存）；无账号体系、无 PII 主体。
8. 坐标全链路 GCJ-02，只在系统 WGS84 定位入口转一次；缓存/上报不二次偏移。
9. 无网只展示本机会话内最近结果；地图失败指数退避重试并保留文本路线；文案平静。

## 9. 测试与验证

- **C 内核（CTest，宿主机 + arm64）**：`test_geo`（距离/方位误差）、`polyline`（round-trip、DP 误差、累计里程）、`route`（黄金折线：step 推进/偏航/到达）、`fmt`（边界快照）、`cache`（字节上限/LRU 序）、`city`（bbox 边界）、`rank`（排序快照）。
- **Android**：`testDebugUnitTest` 覆盖 Repository；`connectedDebugAndroidTest` 验 JNI 句柄生命周期（1000 次 parse/destroy 无泄漏）；Compose 截图 + 无障碍语义断言；Macrobenchmark 测启动与帧。
- **iOS**：XCTest 测 `CiapBridge` 与格式化；XCUITest 走搜索→路线→导航主路径；截图只在模拟器做布局，内存结论只认真机。
- **契约回归**：同一份 fixture JSON 同时喂 CTest、Android instrumentation、iOS XCTest，三端输出逐字段比较。
- **设备矩阵**：Android 低端 4GB（含一台激进后台管理的国产 ROM）2 台、中端 2 台、旗舰 1 台；iOS iPhone SE 级 + 主流 iPhone 各 1 台；模拟器只做布局/大字体，不作内存结论。
- **验收阈值**：浏览 PSS ≤ 180、导航峰值 ≤ 195、30 分钟增长 ≤ 5MB；冷启动 p50 ≤ 2.0s；掉帧 ≤ 2%；搜索 p95 ≤ 800ms；路线 p95 ≤ 2.5s；crash-free ≥ 99.5%；C 测试全绿；30 分钟导航无 native crash。

```bash
# Android 内存：静置 30s 后取 TOTAL PSS（Windows 用 Select-String "TOTAL" 代替 sed）
adb shell am force-stop com.ciap.app && adb shell am start -W -n com.ciap.app/.MainActivity
adb shell dumpsys meminfo com.ciap.app | sed -n '/TOTAL/p'
adb shell dumpsys gfxinfo com.ciap.app framestats
# iOS 真机：xcrun xctrace record --template 'Allocations' --attach <pid> --time-limit 60s --output nav.trace
```

## 10. 风险与取舍

| 风险 | 影响 | 缓解 |
|---|---|---|
| AMap 引擎内存随 ROM/GPU 差异大 | 预算 ±15–20% | 留 20MB headroom；熔断阶梯；P1 起持续采集 PSS |
| 引入 Navi 的包体与内存 | 突破体积/预算 | v1 自绘引导；Navi 只做 A/B，默认关闭 |
| C–JNI/ObjC 边界调试成本 | 崩溃难定位 | 内核纯计算、无 IO/回调；句柄生命周期 instrumentation 覆盖；native 崩溃符号化 |
| 自定义样式能力有限 | 达不到"通透" | 底图降噪 + UI 层玻璃覆盖，不追求重绘全部元素 |
| iOS AMap SDK 与 Android 行为差异 | 逻辑/视觉不一致 | C 统一逻辑；P2 前 iOS 地图 spike；差异进 parity checklist |
| Web 服务配额/QPS/城市限制 | 搜索路线不可用 | BFF 缓存 + 限流 + 单城；提前确认商用授权与配额 |
| 单地图实例与 Compose 生命周期冲突 | 重复建图→内存飙升 | 稳定宿主 + 明确 destroy 时序；进引导前先销毁浏览地图 |
| 玻璃/模糊动效开销 | 掉帧、GPU 内存 | 静态半透明为主；模糊仅小面积且限系统能力 |
| 坐标转换错误/漂移 | 位置错位 | 转换唯一入口 + 济南地标黄金坐标回归 |

## 11. 分阶段路线图

| 阶段 | 范围 | 退出条件 |
|---|---|---|
| P0（当前） | Web 原型：fixtures + 视觉/交互验证 | 五屏与四模式体验定稿；UX token 冻结 |
| P1 | Android 壳 + 地图 + 搜索 + 路线页；C v1（geo/polyline/fmt/city/cache/rank）；BFF v1；样式 v1 | 浏览 PSS ≤ 180；冷启动 p50 ≤ 2.0s；搜索/路线达 §6；AAB ≤ 25MB |
| P2 | 自绘引导：C 进度/maneuver/偏航/重规划 + TTS + 常亮；Navi 评估 | 30 分钟路测无崩溃、PSS ≤ 195；偏航 3s 内发现；决定是否接 Navi |
| P3 | iOS 对等：XCFramework + ObjC++ 桥 + SwiftUI + MAMapView | 同套 fixture 输出一致；footprint 同级；XCTest 通过 |
| P4 | 性能硬化：baseline profile、启动 trace、内存 macrobench 进 CI、R8/体积审计、上架合规 | 指标进 CI 看板；连续 3 版本无回退 |

不扩张范围：无社交/点评/预订/广告/账号；无多城市（仅配置预留）；无离线导航（仅官方离线地图能力可选）。
