# 从数据打开可运行的工程

需要 Python 3.10+、Node.js 22+、npm、可用 WebGL 2 的 Chromium、包含 libx265 和 zscale 的 FFmpeg 与 ffprobe。城市数据转换仅用 Python 标准库。检查影片用 NumPy，制作循环配乐另用 SciPy。Three.js 与 Playwright 的版本固定在工程依赖中。用 npm 安装依赖和 Chromium 后，建模、预览与渲染均可在本机进行。

1. 将 assets/starter 整个复制到新的项目目录，以下终端命令均从该项目目录执行。命令中的 SKILL_DIR 代表解压后的 city-film-studio 目录，请替换为实际位置。可以将 FFMPEG、FFPROBE 环境变量分别指向工具的完整路径。

~~~sh
npm install
node node_modules/playwright/cli.js install chromium
python -m pip install numpy scipy
~~~

2. 先裁剪街区并转成 WGS84 GeoJSON，输入包含 Polygon 或 MultiPolygon。自选原点、数据出处和实际字段名。以下参数对应芝加哥试跑，源表 stories 为楼层，3.4 米层高及 9 米缺失值为制作假设。下载时可用该数据表的 Socrata 地理查询，筛选范围 within_box(the_geom,41.8849,-87.6335,41.8798,-87.6264)，格式为 GeoJSON。[Chicago Building Footprints](https://data.cityofchicago.org/d/syp8-uezg)

~~~sh
python "SKILL_DIR/scripts/prepare_city.py" district.geojson scene/city.json --city Chicago --origin -87.62995 41.88235 --source "City of Chicago Building Footprints" --id-field bldg_id --height-field height --levels-field stories --floor-metres 3.4 --fallback 9
~~~

有真实楼高时传 --height-field，英尺数据加 --unit ft。缺少楼高和层数时，省略 --fallback 就会跳过并计数。工具保留每个体块的高度依据。源属性为“12 m”等字符串、建筑分部或建筑地面标高时，先统一单位和语义。对于同地叠置的建筑分部，应建立底标高及顶标高，或换用源三维模型。

**手头还没有本城数据时**，可以用包里的虚构站前街区练习。新建项目后，将上面的导入命令换成下面这条。四个体块都标为假设高度，庭院内环与双部件仓房都有保留。把 assets/practice/direction.json 复制为项目的 scene/direction.json，将 film.json 的 loop 设为 false、frames 设为 96、fps 设为 24，可得到 4 秒无声的俯视、站前和院落路线。

~~~sh
python "SKILL_DIR/scripts/prepare_city.py" "SKILL_DIR/assets/practice/footprints.geojson" scene/city.json --city "站前练习街区" --source "虚构训练数据" --origin 112 35 --fallback 7
~~~

3. 编辑 film.json 设置宽、高、整数帧率和总帧数，时长为 frames / fps。默认是 25 秒原生 4K60。启动预览后打开下方地址，关闭服务用 Ctrl+C。

~~~sh
python -m http.server 8000 --bind 127.0.0.1
~~~

浏览器地址为 http://127.0.0.1:8000/index.html 。将自己城市的路线填入 scene/direction.json。shots 数组里的 at 为全片进度，eye 和 look 为 [东,高,南] 米数，width 为对焦平面可见宽度，parallel 从透视的 0 连续到正交的 1。循环片的首末姿态应一致。非循环片在 film.json 设置 loop 为 false。街区坐标与此处芝加哥示例一致时，可复制 [实测的入街与俯瞰路线](chicago-route.json) 到 scene/direction.json 试跑。换城后根据自己的地块和道路重新定点。

有主角模型时，向 direction.json 的 landmarks 加入形如 {"file":"station.glb","position":[12,0,-8],"yaw":35,"scale":1,"replaces":["184.0"]} 的条目。文件相对于 scene/，yaw 为绕竖轴旋转的度数，scale 是模型原始单位到米的比例。replaces 取自 city.json 的建筑 ID，用于移除地标占用处的旧体块。未建模的地标可先用体块和照片做轮廓匹配，记录仍需补的侧面和尺寸。

通过 scene/stage.mjs 的 buildStage() 构造进一步的美术细节，pose(phase,aspect) 在每次采样时更新全部运动与相机矩阵。将主体、前后景和容易出重影的几何设为可见锚点。anchors 接口接收世界坐标向量，运动锚点应在 pose 中同步更新。道具、模型和贴图放在 scene 目录内。自编镜头也可以单独调用 scene/lens.mjs 中的 blendProjection(camera, focusDistance, width, parallel)。

4. 自编路线可以先运行 node check-route.mjs。它逐帧检查相机中心是否进入建筑实体，识别庭院，打印连续帧段、建筑 ID 和高度依据。它只检查导入的体块，加入玻璃塔尖、树木、车辆或天桥后，还要检查真实镜头和近裁剪面的空间。无交集也要原速审片。

5. 使用不同输出文件名导出动态灰模、单张目标规格关键帧、最终成片。后两条命令使用相同的主画质设置。按实际片长选择 --frame。无声委托省略 --audio。

~~~sh
node render.mjs draft motion.mp4
node render.mjs proof hero.png --frame 120
node render.mjs master film.mp4 --audio score.wav --cache /path/to/render-cache
python "SKILL_DIR/scripts/check_film.py" film.mp4 film.json --master --score score.wav
~~~

Windows 的 --cache 可填写带引号的盘符目录，例如 "F:/CityRender"。底板通过浮点目标累积子帧，将 10 位 RGB 帧送入编码器。PNG 样张使用 sRGB，视频使用 BT.709。每 120 帧校验并提交一个缓存分段。修改 scene 内的内容、配置或渲染器会产生新的缓存标识。只换音乐时复用已有画面分段。草稿最长边为 960 像素，使用单次采样。对大规模资产采用流式分区或实例化，并把第三方库版本锁文件放进自己的工程包。

6. 用包内 package_project.py 打包底板项目。将实际使用并可分享的资产及相应来源清单纳入 scene/，并把确认的配乐显式传给 --score。脚本会核验指定成片、记录校验值、写入默认配乐，并带上可离线预览的 Three.js 运行文件。用户得到的 ZIP 无需附整套渲染缓存，工程可在新目录打开。若使用了底板以外的新依赖，也应在干净环境验证并把用到的运行文件加入包中。

~~~sh
python "SKILL_DIR/scripts/package_project.py" . city-project.zip --master film.mp4 --score score.wav
~~~

### 示例测试范围

芝加哥试跑覆盖街区轮廓导入、米制方位、建筑体块、程序窗格、原速检查、独立 4K 样张及短段导出。自动体块用于确认地理和相机，近景立面的构造、城市主角、声音和正式镜头按制作工作流继续完成。
