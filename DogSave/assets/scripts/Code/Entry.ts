import { _decorator, sys, input, Input } from "cc"
const { ccclass } = _decorator;
import { Log } from "../Mono/Module/Log/Log"
import { ManagerProvider } from "../Mono/Core/Manager/ManagerProvider"
import { Messager } from "../Mono/Module/Messager/Messager"
import { TimerManager } from "../Mono/Module/Timer/TimerManager"
import { ResourceManager } from "./Module/Resource/ResourceManager"
import { UIManager } from "./Module/UI/UIManager"
import { GameObjectPoolManager } from "./Module/Resource/GameObjectPoolManager"
import { CoroutineLockManager } from "./Module/CoroutineLock/CoroutineLockManager"
import { SceneManager } from "./Module/Scene/SceneManager"
import { LoginScene } from "./Game/Scene/LoginScene"
import { I18NManager } from "./Module/I18N/I18NManager"
import { ConfigManager } from "./Module/Config/ConfigManager"
import { ImageLoaderManager } from "./Module/Resource/ImageLoaderManager"
import { CameraManager } from "./Module/Camera/CameraManager"
import { SoundManager } from "./Module/Resource/SoundManager"
import { MaterialManager } from "./Module/Resource/MaterialManager"
import { CacheManager } from "./Module/Player/CacheManager"
import { ServerConfigManager } from "./Module/Update/ServerConfigManager"
import { UIUpdateView } from "./Game/UI/UIUpdate/UIUpdateView"
import { UILayerNames } from "./Module/UI/UILayerNames"
import { Define } from "../Mono/Define"
import { GameDataManager } from "./Game/GameDataManager";

@ccclass('Entry')
export class Entry 
{  
    public static start()
    {
        Log.info("Entry.start");
        Entry.startAsync();
    }
    
    private static async startAsync() {
        try {
            // === 阶段 A: 注册基础 Manager ===
            ManagerProvider.registerManager(Messager);
            ManagerProvider.registerManager(CoroutineLockManager);
            ManagerProvider.registerManager(TimerManager);
            ManagerProvider.registerManager(CacheManager);

            const cm = ManagerProvider.registerManager(ConfigManager);

            ManagerProvider.registerManager(ResourceManager);
            ManagerProvider.registerManager(GameObjectPoolManager);

            ManagerProvider.registerManager(I18NManager);
            ManagerProvider.registerManager(UIManager);

            // 先把文案表等到位再开界面。
            // ⚠️ `I18NManager.init()` 里的 `initAsync()` 是不 await 的（要异步加载 config bundle），
            //    不等的话第一个界面（以及热更新弹窗）会把 key 名当文本显示出来。
            await I18NManager.instance.Ready;

            if (sys.isNative && (Define.Networked||Define.ForceUpdate)) {
                await cm.loadAsync();
                ManagerProvider.registerManager(ServerConfigManager);
                // === 阶段 B: 热更新检查 ===
                await UIManager.instance.openWindow<UIUpdateView, VoidFunction>(
                    UIUpdateView, UIUpdateView.PrefabPath, Entry.startGame
                );
            } else {
                // 编辑器中直接进入游戏
                Entry.startGameAsync(false);
            }
        } catch (e: any) {
            Log.error(e);
        }
    }

    private static async startGame(){
        Entry.startGameAsync(true);
    }


    /**
     * 更新完成后, 注册剩余 Manager 并进入游戏
     */
    private static async startGameAsync(configInit: boolean)
    {
        if(!configInit) await ConfigManager.instance.loadAsync();
        ManagerProvider.registerManager(ImageLoaderManager);
        ManagerProvider.registerManager(MaterialManager);
        ManagerProvider.registerManager(CameraManager);
        ManagerProvider.registerManager(SceneManager);
        ManagerProvider.registerManager(SoundManager);
        ManagerProvider.registerManager(GameDataManager);
        await SceneManager.instance.switchScene(LoginScene);
        await Entry.startBgm();
    }

    /**
     * 起播背景音乐。
     *
     * ⚠️ 必须先 await `SoundManager.Ready`：`init()` 里的 `initAsync()` 是**不 await**
     * 的 —— 它要先异步加载 `audio/common/source` 预制体，才有 AudioSource 可用。
     * 抢跑会走到 `createAudioSource()`、因为 soundsClipClone 还是 null 而返回 null，
     * 于是 playMusic 静默返回 0n，**一声都不出、也不报错**。
     *
     * ⚠️ 浏览器 / 小游戏在玩家第一次交互之前不允许自动播放，`play()` 不出声也不抛异常。
     * 所以再挂一个一次性触摸回调补播。`playMusic` 对同一路径走"已存在"分支，
     * 只在 `!playing` 时补一次 `play()` —— 已经在播时是空操作，不会把曲子重头放。
     */
    private static async startBgm() {
        const sm = SoundManager.instance;
        if (sm == null) return;
        await sm.Ready;
        sm.playMusic(SoundManager.BGM_MAIN);

        const resume = () => {
            input.off(Input.EventType.TOUCH_START, resume);
            SoundManager.instance?.playMusic(SoundManager.BGM_MAIN);
        };
        input.on(Input.EventType.TOUCH_START, resume);
    }
}
