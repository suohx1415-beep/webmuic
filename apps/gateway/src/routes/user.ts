import { Router } from 'express';
import { adapterOf } from '../adapters/index.js';
import { asyncHandler } from '../http.js';
import type { UserLibraryResult } from '../types.js';

export const userRouter = Router();

/**
 * GET /api/user/playlists
 * 获取网易云与 QQ 音乐当前登录用户的云端歌单与"我喜欢的音乐 / 红心歌单"。
 * 未登录平台返回 { configured: false, playlists: [] }，不抛错，便于前端直接展示状态。
 */
userRouter.get(
  '/playlists',
  asyncHandler(async (_req, res) => {
    const [netease, qq] = await Promise.all([
      adapterOf('netease').userLibrary(),
      adapterOf('qq').userLibrary(),
    ]);

    const result: UserLibraryResult = {
      netease,
      qq,
    };

    res.json(result);
  }),
);
