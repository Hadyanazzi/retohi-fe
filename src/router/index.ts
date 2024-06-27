import { createRouter, createWebHistory, createWebHashHistory } from "vue-router"

const router = createRouter({
  history: createWebHashHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: "/",
      name: "base",
      // route level code-splitting
      // this generates a separate chunk (About.[hash].js) for this route
      // which is lazy-loaded when the route is visited.
      component: () => import("../views/BaseView.vue"),
      children: [
        {
          path: "/",
          name: "Dashboard",
          // route level code-splitting
          // this generates a separate chunk (About.[hash].js) for this route
          // which is lazy-loaded when the route is visited.
          component: () => import("../views/dashboard/DashboardPage.vue"),
        },
        {
          path: "/campaign",
          name: "Campaign",
          // route level code-splitting
          // this generates a separate chunk (About.[hash].js) for this route
          // which is lazy-loaded when the route is visited.
          component: () => import("../views/campaign/CampaignPage.vue"),
        },
        {
          path: "/campaign/create",
          name: "Create Campaign",
          // route level code-splitting
          // this generates a separate chunk (About.[hash].js) for this route
          // which is lazy-loaded when the route is visited.
          component: () => import("../views/campaign/CreateCampaignPage.vue"),
        },
        {
          path: "/campaign/:campaignId",
          name: "Update Campaign",
          // route level code-splitting
          // this generates a separate chunk (About.[hash].js) for this route
          // which is lazy-loaded when the route is visited.
          component: () => import("../views/campaign/UpdateCampaignPage.vue"),
        },
        {
          path: "/audience",
          name: "Audience",
          // route level code-splitting
          // this generates a separate chunk (About.[hash].js) for this route
          // which is lazy-loaded when the route is visited.
          component: () => import("@/views/audience/AudiencePage.vue"),
        },
        {
          path: "/audience-group",
          name: "Group",
          // route level code-splitting
          // this generates a separate chunk (About.[hash].js) for this route
          // which is lazy-loaded when the route is visited.
          component: () => import("@/views/audience/AudienceGroupPage.vue"),
        },
        {
          path: "/message",
          name: "Message",
          // route level code-splitting
          // this generates a separate chunk (About.[hash].js) for this route
          // which is lazy-loaded when the route is visited.
          component: () => import("../views/message/MessagePage.vue"),
        },
        {
          path: "/message/create",
          name: "Add Message",
          // route level code-splitting
          // this generates a separate chunk (About.[hash].js) for this route
          // which is lazy-loaded when the route is visited.
          component: () => import("../views/message/CreateMessagePage.vue"),
        },
        {
          path: "/message/:templateId",
          name: "Update Message",
          // route level code-splitting
          // this generates a separate chunk (About.[hash].js) for this route
          // which is lazy-loaded when the route is visited.
          component: () => import("../views/message/UpdateMessagePage.vue"),
        },
        {
          path: "/facebook",
          name: "Facebook",
          // route level code-splitting
          // this generates a separate chunk (About.[hash].js) for this route
          // which is lazy-loaded when the route is visited.
          component: () => import("../views/facebook/FacebookPage.vue"),
        },
        {
          path: "/account",
          name: "Account",
          // route level code-splitting
          // this generates a separate chunk (About.[hash].js) for this route
          // which is lazy-loaded when the route is visited.
          component: () => import("../views/account/AccountPage.vue"),
        }
      ]
    },
    {
      path: "/sign-in",
      name: "login",
      component: () => import("../views/LoginView.vue")
    },
    {
      path: "/terms",
      name: "terms",
      component: () => import("../views/other/TermsOfServicePage.vue")
    },
    {
      path: "/policy",
      name: "policy",
      component: () => import("../views/other/PolicyPage.vue")
    },
    {
      path: "/**",
      redirect: "/facebook",
    },
  ]
})

export default router
