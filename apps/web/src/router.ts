import { createRouter, createWebHashHistory } from 'vue-router';

/**
 * 用 hash 历史，避免 dev server 与静态预览在刷新子路由时 404。
 * 本项目只在本机运行，不需要 SEO 友好的 path 路由。
 */
export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', redirect: '/discover' },
    { path: '/search', name: 'search', component: () => import('@/views/SearchView.vue') },
    { path: '/discover', name: 'discover', component: () => import('@/views/DiscoverView.vue') },
    { path: '/playlist/:id', name: 'playlist', component: () => import('@/views/PlaylistView.vue') },
    { path: '/favorites', name: 'favorites', component: () => import('@/views/FavoritesView.vue') },
    { path: '/settings', name: 'settings', component: () => import('@/views/SettingsView.vue') },
    { path: '/:pathMatch(.*)*', redirect: '/discover' },
  ],
});
