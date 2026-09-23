import { Camera, find, Node, _decorator, view, Vec2, Layers } from 'cc';
import { IManager } from "../../../Mono/Core/Manager/IManager"
import { JsonType } from '../../Mono/Helper/JsonHelper';
import { DateItem } from './UI/UIMain/DateItem';
import { CacheManager } from '../Module/Player/CacheManager';
import { ConfigManager } from '../Module/Config/ConfigManager';
import { Log } from '../../Mono/Module/Log/Log';


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
        this.curLevelConfig = GameDataManager.instance.GetLevelCfgById(this.curFightLevelId).clone();
        CacheManager.instance.setInt("FightLevelId", levelId)
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
}

