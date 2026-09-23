import { _decorator, Button, Component, Label, Node } from 'cc';
import { $ } from '../../../../../../extensions/taowu-editor/source/panel';
import { GameDataManager, LevelConfig } from '../../GameDataManager';
import { ChairNode } from './ChairNode';
const { ccclass, property } = _decorator;

@ccclass('GameMainObj')
export class GameMainObj extends Component {
      
    @property(Label)
    public levelText: Label;
    
    @property(Button)
    public settingBtn: Button;

    @property(ChairNode)
    public chairNodes:ChairNode[] = [];

    start() {
        GameDataManager.instance.gameMainObj = this;
        this.levelText.string = `第${GameDataManager.instance.curFightLevelId}关`;
        let cfg:LevelConfig = GameDataManager.instance.curLevelConfig;
        for (let i = 0; i < this.chairNodes.length; i++)
        {
            let chairNode:ChairNode = this.chairNodes[i];
            if (i < cfg.chairs.length)
            {
                chairNode.node.active = true;
                chairNode.RefreshAllSlot(cfg.chairs[i].dogs);
            }
            // else if (i == cfg.chairs.length)
            // {
            //     chairNode.node.active = true;
            //     //ads
            // }
            else
                chairNode.node.active = false;
        }
    }

    update(deltaTime: number) {
        
    }
}

