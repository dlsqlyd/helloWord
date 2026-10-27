import { _decorator, screen, sys, view } from 'cc';
import { DEBUG, EDITOR } from 'cc/env';
import { FORCE_UPDATE } from 'cc/userland/macro';

export class Define {

    private static readonly dWidth = 1080;
    private static readonly dHeight = 1920;

    public static isSH: boolean = false;

    public static get DesignScreenWidth() 
    {
        if(EDITOR){
            return view.getDesignResolutionSize().width > view.getDesignResolutionSize().height?Math.max(Define.dWidth, Define.dHeight) : Math.min(Define.dWidth, Define.dHeight);
        }
        return screen.windowSize.width > screen.windowSize.height?Math.max(Define.dWidth, Define.dHeight) : Math.min(Define.dWidth, Define.dHeight);
    }

    public static get DesignScreenHeight() {
        if(EDITOR){
            return view.getDesignResolutionSize().width > view.getDesignResolutionSize().height?Math.min(Define.dWidth, Define.dHeight) : Math.max(Define.dWidth, Define.dHeight);
        }
        return screen.windowSize.width > screen.windowSize.height?Math.min(Define.dWidth, Define.dHeight) : Math.max(Define.dWidth, Define.dHeight);
    }
    
    public static LogLevel = 1;

    public static Process = 1;

    /**
     * 热更新总开关（只对原生包生效）
     * 原生包(安卓/iOS): false = 只用安装包内(builtin)的资源, 更新流程全程短路, 不发任何
     *   网络请求, 也不会去读本地缓存的远端 manifest(避免旧包残留导致仍走远程 URL)
     * 微信小游戏 / Web: 恒为 true, 完全保持原有逻辑, 不受此开关影响
     *   —— 小游戏的远程包/热更走的是另一套(settings.assets.remoteBundles), 不要在这里一刀切
     */
    public static get HotUpdateEnabled(): boolean {
        if (sys.isNative) return false;
        return true;
    }

    public static readonly MinRepeatedTimerInterval: number = 100;

    public static get Debug(){
        return DEBUG;
    }

    public static get ForceUpdate(){
        if(FORCE_UPDATE){
            return true;
        }
        return false;
    }

    public static get Networked(){
        if(EDITOR) return false;
        return sys.getNetworkType() != sys.NetworkType.NONE;
    }
}