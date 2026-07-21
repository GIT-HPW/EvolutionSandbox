-- SPDX-License-Identifier: GPL-3.0-or-later
-- Generated from content/chapters/origin.json; run npm run build:content after editing.
return {
    ["$schema"] = "../schemas/content-pack.schema.json",
    ["actions"] = {
        ["big_bang"] = {
            ["availableIn"] = {
                "origin_0d",
            },
            ["delta"] = {
                ["energy"] = 8,
                ["entropy"] = -6,
                ["stability"] = 6,
            },
            ["requires"] = {
                ["entropy"] = 12,
                ["fragments"] = 2,
                ["information"] = 12,
            },
            ["result"] = "混沌体破裂，时间、空间与首个三维领域形成。",
            ["set"] = {
                ["dimension"] = 3,
                ["phase"] = "first_3d",
            },
            ["title"] = "触发大爆炸",
        },
        ["create"] = {
            ["availableIn"] = {
                "first_3d",
            },
            ["delta"] = {
                ["energy"] = -2,
                ["entropy"] = 1,
                ["information"] = 1,
                ["matter"] = 1,
                ["matterCreated"] = 1,
            },
            ["requires"] = {
                ["energy"] = 2,
            },
            ["result"] = "能量凝聚为可塑的原始物质。",
            ["title"] = "创造物质",
        },
        ["destroy"] = {
            ["availableIn"] = {
                "first_3d",
            },
            ["delta"] = {
                ["energy"] = 1,
                ["entropy"] = 2,
                ["matter"] = -1,
                ["matterRecycled"] = 1,
                ["stability"] = -1,
            },
            ["requires"] = {
                ["matter"] = 1,
            },
            ["result"] = "物质回归能量，系统熵继续增长。",
            ["title"] = "毁灭物质",
        },
        ["fuse"] = {
            ["availableIn"] = {
                "origin_0d",
            },
            ["delta"] = {
                ["energy"] = 3,
                ["entropy"] = -1,
                ["fragments"] = -1,
                ["information"] = 1,
                ["stability"] = 2,
            },
            ["requires"] = {
                ["fragments"] = 1,
            },
            ["result"] = "一次局部自我更新完成。",
            ["title"] = "融合碎片",
        },
        ["observe"] = {
            ["availableIn"] = {
                "origin_0d",
                "first_3d",
            },
            ["delta"] = {
                ["entropy"] = 2,
                ["information"] = 3,
                ["stability"] = -1,
            },
            ["result"] = "认知增加，但观察本身改变了系统。",
            ["title"] = "观察混沌",
        },
        ["split"] = {
            ["availableIn"] = {
                "origin_0d",
            },
            ["delta"] = {
                ["energy"] = -4,
                ["entropy"] = 3,
                ["fragments"] = 2,
                ["stability"] = -2,
            },
            ["requires"] = {
                ["energy"] = 4,
                ["stability"] = 2,
            },
            ["result"] = "整体控制减弱，能量信息碎片出现。",
            ["title"] = "撕裂自身",
        },
        ["stabilize"] = {
            ["availableIn"] = {
                "first_3d",
            },
            ["delta"] = {
                ["energy"] = -1,
                ["entropy"] = -2,
                ["information"] = -2,
                ["matterStabilized"] = 1,
                ["stability"] = 3,
            },
            ["requires"] = {
                ["energy"] = 1,
                ["information"] = 2,
                ["matter"] = 1,
            },
            ["result"] = "以能量和认知换取局部时空稳定。",
            ["title"] = "稳定时空",
        },
    },
    ["demo"] = {
        "observe",
        "observe",
        "observe",
        "observe",
        "split",
        "split",
        "big_bang",
    },
    ["id"] = "evolution.origin",
    ["initialState"] = {
        ["dimension"] = 0,
        ["energy"] = 24,
        ["entropy"] = 0,
        ["fragments"] = 0,
        ["information"] = 0,
        ["matter"] = 0,
        ["matterCreated"] = 0,
        ["matterRecycled"] = 0,
        ["matterStabilized"] = 0,
        ["phase"] = "origin_0d",
        ["schema"] = 1,
        ["stability"] = 12,
        ["steps"] = 0,
        ["timeline"] = "origin",
    },
    ["license"] = "GPL-3.0-or-later",
    ["limits"] = {
        ["energy"] = {
            ["max"] = 999,
            ["min"] = 0,
        },
        ["entropy"] = {
            ["max"] = 999,
            ["min"] = 0,
        },
        ["fragments"] = {
            ["max"] = 999,
            ["min"] = 0,
        },
        ["information"] = {
            ["max"] = 999,
            ["min"] = 0,
        },
        ["matter"] = {
            ["max"] = 999,
            ["min"] = 0,
        },
        ["matterCreated"] = {
            ["max"] = 999999,
            ["min"] = 0,
        },
        ["matterRecycled"] = {
            ["max"] = 999999,
            ["min"] = 0,
        },
        ["matterStabilized"] = {
            ["max"] = 999999,
            ["min"] = 0,
        },
        ["stability"] = {
            ["max"] = 100,
            ["min"] = 0,
        },
        ["steps"] = {
            ["max"] = 999999,
            ["min"] = 0,
        },
    },
    ["phases"] = {
        {
            ["dimension"] = 0,
            ["id"] = "origin_0d",
            ["objective"] = "观察混沌、主动撕裂并积累足够的信息与熵，触发大爆炸。",
            ["title"] = "零维原点",
        },
        {
            ["dimension"] = 3,
            ["id"] = "first_3d",
            ["objective"] = "完成首次物质凝聚、稳定与回收，为时间线分支准备领域锚点。",
            ["title"] = "首个三维领域",
        },
    },
    ["schemaVersion"] = 1,
    ["source"] = {
        ["adaptation"] = "规则化改编：把原始能量信息体、熵增、撕裂、融合和大爆炸转化为可重复游玩的状态机。",
        ["chapters"] = {
            "第1章 第1篇 原点：一切的源",
            "第1章 第2篇 时空：宇宙的格局",
        },
        ["repository"] = "https://github.com/GIT-HPW/Evolution-",
    },
    ["title"] = "原点：从零维混沌到首个三维领域",
    ["version"] = "0.2.0",
}
