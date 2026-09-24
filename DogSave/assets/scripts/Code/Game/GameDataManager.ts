import { Camera, find, Mat4, Node, UITransform, Vec3, _decorator, view, Vec2, Layers } from 'cc';
import { IManager } from "../../../Mono/Core/Manager/IManager"
import { JsonType } from '../../Mono/Helper/JsonHelper';
import { DateItem } from './UI/UIMain/DateItem';
import { CacheManager } from '../Module/Player/CacheManager';
import { ConfigManager } from '../Module/Config/ConfigManager';
import { Log } from '../../Mono/Module/Log/Log';
import { GameMainObj } from './UI/UIGameMain/GameMainObj';
import { ready } from '../../../../extensions/taowu-editor/source/panel';

// 坐标转换用的临时矩阵。这两个函数在飞行动画里会逐帧调用，
// 每次 new Mat4 会白白产生垃圾，所以复用。
const _matWorld: Mat4 = new Mat4();
const _matInv: Mat4 = new Mat4();


@JsonType("LevelDatas")
class LevelDatas {
    public data: LevelConfig[];
    public endInit()
    {
                    
    }
}

@JsonType("LevelConfig")
export class LevelConfig {
    /** Id*/
    public id: number;
    /** 时间*/
    public time: number;
    /** 椅子*/
    public chairs: LevelChairData[];
   
}

@JsonType("LevelChairData")
export class LevelChairData {
    public dogs: number[];
}

export class GameDataManager implements IManager {
    private static _instance: GameDataManager;
    private datas: LevelDatas;
    private leveldict: Map<number, LevelConfig>
    public curFightLevelId:number = 1;
    private curSelectChairIdx:number = -1;
    public curLevelConfig:LevelConfig;
    public gameMainObj:GameMainObj;


    public static get instance(): GameDataManager {
        return GameDataManager._instance;
    }


    public resolution: Vec2
   

    public async init() {
        GameDataManager._instance = this;
        await this.LoadLevelConfig();
        // Messager.Instance.AddListener<int, int>(0, MessageId.OnKeyInput, OnKeyInput);
    }

    public async LoadLevelConfig()
    {
        if (this.leveldict != null)
            return;
        if (ConfigManager.instance == null)
            return;
        this.datas = await ConfigManager.instance.get<LevelDatas>(LevelDatas,"levels");
        this.leveldict = new Map<number, LevelConfig>();
        for (let i = 0; i <  this.datas.data.length; i++)
        {
            let data = this.datas.data[i];
            this.leveldict.set(data.id, data);
        }
        this.curFightLevelId = CacheManager.instance.getInt("FightLevelId", 1);
        if (this.curFightLevelId > this.datas.data.length)
            this.curFightLevelId = this.datas.data.length;
        let cfg2:LevelConfig = GameDataManager.instance.GetLevelCfgById(this.curFightLevelId);
        this.curLevelConfig = this.CloneLevelCfg(cfg2);
    }

    private CloneLevelCfg(oldCfg:LevelConfig):LevelConfig
    {
        let newCfg:LevelConfig = new LevelConfig();
        newCfg.id = oldCfg.id;
        newCfg.time = oldCfg.time;
        newCfg.chairs = new Array<LevelChairData>(oldCfg.chairs.length);
        for (let i = 0; i < oldCfg.chairs.length; i++)
        {
           
            let newChair:LevelChairData = new LevelChairData();
            let oldChair:LevelChairData = oldCfg.chairs[i];
            newChair.dogs = new Array<number>(oldChair.dogs.length);
            for (let i = 0; i < oldChair.dogs.length; i++)
            {
                newChair.dogs[i] = oldChair.dogs[i];
            }
            newCfg.chairs[i] = newChair;
        }
        return newCfg;
    }

    public destroy() {
        // Messager.Instance.RemoveListener<int, int>(0, MessageId.OnKeyInput, OnKeyInput);
        GameDataManager._instance = null;
        this.leveldict.clear();
        this.leveldict = null;
        this.onDestroyAsync();
    }

    private async onDestroyAsync() {
        Log.info("UIManagerComponent Destroy");
    }

    public GetLevelCfgById(levelId:number):LevelConfig
    {
        this.LoadLevelConfig();
        let cfg = this.leveldict.get(levelId)
        return cfg;
    }

    public SetLevelCfgById(levelId:number)
    {
        this.curFightLevelId = levelId;
        if (this.curFightLevelId > this.datas.data.length)
            this.curFightLevelId = this.datas.data.length;
        this.curLevelConfig = this.CloneLevelCfg(GameDataManager.instance.GetLevelCfgById(this.curFightLevelId));
        CacheManager.instance.setInt("FightLevelId", levelId)
        this.gameMainObj.start();
    }

    public SetSelectChairId(chairId:number)
    {
        if (this.curSelectChairIdx < 0)
        {
            this.curSelectChairIdx = chairId
        }
        else
        {
            if (this.IsCanChange(this.curSelectChairIdx, chairId))
            {
                
            }
        }

    }

     //判断是否可以飞入
    public IsCanChange(fromIndx:number, toIndex:number):boolean
    {
        let fromChair:LevelChairData = this.curLevelConfig.chairs[fromIndx];
        let toChair:LevelChairData = this.curLevelConfig.chairs[toIndex];
        let fromColor = 0;
        let toColor = 0;
        for (let i = fromChair.dogs.length - 1; i >= 0; i--)
        {
            if (fromChair.dogs[i] > 0)
            {
                fromColor = fromChair.dogs[i];
                break;
            }
        }
        for (let i = toChair.dogs.length - 1; i >= 0; i--)
        {
            if (toChair.dogs[i] > 0)
            {
                toColor = toChair.dogs[i];
                break;
            }
        }
        if (toColor == 0 || toColor == fromColor)
            return true;
        return false;
    }

    public ClearSelectChairId()
    {
        this.curSelectChairIdx = -1;
    }

    // ---------------------------------------------------------------- 坐标转换
    //
    // 这两个函数互为逆运算，参考系都由【parentNode 这个节点自己的局部坐标系】给出 ——
    // 也就是它的子节点 position 所在的那套坐标（原点落在 parentNode 的锚点上）。
    //
    // 参数特意取成「坐标系节点」而不是「被转换的那个节点」，是为了避免歧义：
    // 如果内部偷偷用 node.parent 当坐标系，那么调用方一旦传错层级不会报错，
    // 只会拿到一个看起来正常、实际错位的结果。现在传谁就是谁，写错一眼能看出来。
    //
    // 引擎侧对应的 API 是 UITransform.convertToWorldSpaceAR / convertToNodeSpaceAR，
    // 名字里的 AR = anchor relative。不过看引擎实现（2d/framework/ui-transform.ts）
    // 其实就一句 Vec3.transformMat4(out, p, node.worldMatrix)，AR 只是 Cocos2d
    // 留下来的历史命名，并没有额外的锚点偏移 —— 所以下面这套逻辑对
    // UI 节点和普通 3D 节点都成立。
    //
    // 典型用法（把一只狗从 A 椅挪到 B 椅，屏幕上位置不动）：
    //     let wp = GameDataManager.instance.LocalToWorld(dogNode.parent, dogNode.position);
    //     dogNode.setParent(targetSlot);
    //     dogNode.setPosition(GameDataManager.instance.WorldToLocal(targetSlot, wp));

    /**
     * 局部坐标 → 世界坐标。
     *
     * @param parentNode 参考坐标系所在的节点；localPos 就是「在它下面的相对坐标」
     * @param localPos   在 parentNode 坐标系下的点（父节点锚点为原点）
     * @param out        可选，复用的输出向量；不传则新建一个
     */
    public LocalToWorld(parentNode: Node, localPos: Vec3, out?: Vec3): Vec3
    {
        let res: Vec3 = out || new Vec3();
        // 没有参考坐标系（节点挂在场景根上）时，局部坐标本身就是世界坐标
        if (parentNode == null)
        {
            return Vec3.copy(res, localPos);
        }

        let ui: UITransform = parentNode.getComponent(UITransform);
        if (ui != null)
        {
            return ui.convertToWorldSpaceAR(localPos, res);
        }
        // 普通节点（没有 UITransform）：自己乘世界矩阵，和上面完全等价。
        // getWorldMatrix 内部会先 updateWorldTransform，拿到的不会是不脏的旧矩阵。
        return Vec3.transformMat4(res, localPos, parentNode.getWorldMatrix(_matWorld));
    }

    /**
     * 世界坐标 → 局部坐标。
     *
     * 和 LocalToWorld 互为逆运算：WorldToLocal(n, LocalToWorld(n, p)) === p。
     *
     * @param parentNode 参考坐标系所在的节点；返回值就是「在它下面的相对坐标」
     * @param worldPos   世界坐标
     * @param out        可选，复用的输出向量；不传则新建一个
     */
    public WorldToLocal(parentNode: Node, worldPos: Vec3, out?: Vec3): Vec3
    {
        let res: Vec3 = out || new Vec3();
        // 没有参考坐标系时（parentNode 传 null），世界坐标就是它自己的局部坐标
        if (parentNode == null)
        {
            return Vec3.copy(res, worldPos);
        }

        let ui: UITransform = parentNode.getComponent(UITransform);
        if (ui != null)
        {
            return ui.convertToNodeSpaceAR(worldPos, res);
        }
        // 分开两个临时矩阵，避免 out 和入参是同一个矩阵时的别名问题
        parentNode.getWorldMatrix(_matWorld);
        Mat4.invert(_matInv, _matWorld);
        return Vec3.transformMat4(res, worldPos, _matInv);
    }
}

