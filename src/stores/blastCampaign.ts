import { defineStore } from 'pinia'
import { ref, computed, shallowRef } from 'vue'
import axios, { type AxiosInstance } from 'axios'

// =============================================================================
// DOMAIN TYPES (Aligned with backend Java 22 Record DTOs)
// =============================================================================

export enum ChannelType {
  WHATSAPP = 'WHATSAPP',
  MESSENGER = 'MESSENGER'
}

export enum CampaignStatus {
  DRAFT = 'DRAFT',
  PENDING = 'PENDING',
  QUEUED = 'QUEUED',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  COMPLETED_WITH_ERRORS = 'COMPLETED_WITH_ERRORS',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED'
}

export enum TemplateSelectionStatus {
  UNSELECTED = 'UNSELECTED',
  SELECTED = 'SELECTED',
  VALIDATING = 'VALIDATING',
  VALIDATED = 'VALIDATED',
  INVALID = 'INVALID'
}

// =============================================================================
// API RESPONSE TYPES
// =============================================================================

/**
 * Campaign Status Response DTO from /api/campaign/{id}/status
 * Returned as HTTP 202 Accepted when campaign is queued.
 */
export interface CampaignStatusResponseDto {
  campaignId: string
  campaignName: string
  status: string
  totalAudience: number
  sentCount: number
  failedCount: number
  pendingCount: number
  successRate: number
  estimatedCompletion: string | null
}

export interface SendCampaignResponseDto {
  campaignId: string
  messageList: MessageInfo[]
  audienceList: AudienceInfo[]
}

export interface MessageInfo {
  messageId: string
  messageContent: string
  messageType: string
  messageOrder: number
}

export interface AudienceInfo {
  audienceId: string
  audienceName: string
  sentAt: string | null
  status: string
}

export interface BlastQueueTask {
  blastTaskId: string
  campaignId: string
  tenantId: string
  pageId: string
  pageToken: string
  channel: ChannelType
  recipientId: string
  recipientType: 'PSID' | 'phone'
  messagePayload: string
  messageOrder: number
  enqueuedAt: string
  priority: number
}

export interface ChannelConfiguration {
  channel: ChannelType
  pageId: string
  pageToken: string
  templateId?: string
  isActive: boolean
}

export interface ProgressTracker {
  totalRecipients: number
  totalQueued: number
  totalSent: number
  totalFailed: number
  totalPending: number
  successRate: number
  estimatedCompletion: Date | null
  startedAt: Date | null
}

export interface CampaignBlastConfig {
  campaignId: string
  campaignName: string
  channels: ChannelConfiguration[]
  selectedTemplateId: string | null
  audienceIds: string[]
  intervalMin: number
  intervalMax: number
}

// =============================================================================
// STORE STATE (Using shallowRef for performance with large datasets)
// =============================================================================

export const useBlastCampaignStore = defineStore('blastCampaign', () => {
  // Core state
  const currentConfig = shallowRef<CampaignBlastConfig | null>(null)
  const channelConfigurations = ref<ChannelConfiguration[]>([])
  const templateSelectionStatus = ref<TemplateSelectionStatus>(TemplateSelectionStatus.UNSELECTED)

  // Progress tracking (shallowRef for frequent updates)
  const progressTracker = shallowRef<ProgressTracker>({
    totalRecipients: 0,
    totalQueued: 0,
    totalSent: 0,
    totalFailed: 0,
    totalPending: 0,
    successRate: 0,
    estimatedCompletion: null,
    startedAt: null
  })

  // Active blasts (Map for O(1) lookup)
  const activeBLASTS = shallowRef<Map<string, BlastQueueTask>>(new Map())
  const completedBLASTS = shallowRef<BlastQueueTask[]>([])
  const failedBLASTS = shallowRef<BlastQueueTask[]>([])

  // Idempotency tracking (prevent double-submission)
  const submittedCampaignIds = ref<Set<string>>(new Set())

  // Error state
  const lastError = ref<{ code: string; message: string; timestamp: Date } | null>(null)

  // Loading states
  const isInitializing = ref(false)
  const isBlasting = ref(false)

  // =============================================================================
  // POLLING STATE
  // =============================================================================

  const activePollingCampaignId = ref<string | null>(null)
  const pollingIntervalId = ref<number | null>(null)
  const pollingStatus = ref<'idle' | 'polling' | 'stopped'>('idle')

  // Polling configuration
  const POLLING_INTERVAL_MS = 2000  // Poll every 2 seconds
  const POLLING_MAX_ATTEMPTS = 900  // ~30 minutes max polling

  let pollingAttempts = 0

  // =============================================================================
  // COMPUTED PROPERTIES
  // =============================================================================

  const activeChannel = computed<ChannelConfiguration | null>(() => {
    return channelConfigurations.value.find(c => c.isActive) ?? null
  })

  const pendingBlastCount = computed(() => progressTracker.value.totalPending)

  const isBlastInProgress = computed(() => isBlasting.value && pendingBlastCount.value > 0)

  const currentProgress = computed(() => {
    const { totalSent, totalFailed, totalRecipients } = progressTracker.value
    if (totalRecipients === 0) return 0
    return Math.round(((totalSent + totalFailed) / totalRecipients) * 100)
  })

  const estimatedTimeRemaining = computed(() => {
    const { totalPending, startedAt } = progressTracker.value
    if (!startedAt || totalPending === 0) return null

    const elapsed = Date.now() - startedAt.getTime()
    const sentCount = progressTracker.value.totalSent + progressTracker.value.totalFailed
    if (sentCount === 0) return null

    const ratePerMs = sentCount / elapsed
    return Math.ceil(totalPending / ratePerMs)
  })

  // =============================================================================
  // POLLING ACTIONS
  // =============================================================================

  /**
   * Start polling campaign status.
   * Called after receiving 202 Accepted from /campaign/send/{id}
   *
   * @param campaignId UUID of the campaign to poll
   * @param axiosInstance Optional axios instance for API calls
   */
  function startPollingCampaignStatus(
    campaignId: string,
    axiosInstance: AxiosInstance = axios.create()
  ) {
    // Clear any existing polling
    stopPollingCampaignStatus()

    activePollingCampaignId.value = campaignId
    pollingStatus.value = 'polling'
    pollingAttempts = 0
    isBlasting.value = true

    // Set initial progress
    progressTracker.value = {
      totalRecipients: 0,
      totalQueued: 0,
      totalSent: 0,
      totalFailed: 0,
      totalPending: 0,
      successRate: 0,
      estimatedCompletion: null,
      startedAt: new Date()
    }

    log(`Starting poll for campaign ${campaignId}`)

    // Start polling interval
    pollingIntervalId.value = window.setInterval(async () => {
      try {
        await pollCampaignStatus(campaignId, axiosInstance)
      } catch (error) {
        log(`Polling error for campaign ${campaignId}:`, error)
      }
    }, POLLING_INTERVAL_MS)
  }

  /**
   * Poll campaign status once and update progress.
   */
  async function pollCampaignStatus(campaignId: string, axiosInstance: AxiosInstance) {
    pollingAttempts++

    const response = await axiosInstance.get(`/api/campaign/${campaignId}/status`)
    const statusData: CampaignStatusResponseDto = response.data.data

    log(`Poll #${pollingAttempts}: status=${statusData.status}, sent=${statusData.sentCount}, failed=${statusData.failedCount}`)

    // Update progress tracker with latest data
    progressTracker.value = {
      totalRecipients: statusData.totalAudience,
      totalQueued: statusData.totalAudience,
      totalSent: statusData.sentCount,
      totalFailed: statusData.failedCount,
      totalPending: statusData.pendingCount,
      successRate: statusData.successRate,
      estimatedCompletion: statusData.estimatedCompletion
        ? new Date(statusData.estimatedCompletion)
        : null,
      startedAt: progressTracker.value.startedAt
    }

    // Check if campaign is in a terminal state
    // Matches backend CampaignStatus.isTerminal() enum values
    const terminalStatusStrings = ['COMPLETED', 'COMPLETED_WITH_ERRORS', 'FAILED', 'CANCELLED']

    if (terminalStatusStrings.includes(statusData.status)) {
      log(`Campaign ${campaignId} reached terminal state: ${statusData.status}`)
      stopPollingCampaignStatus()
      completeBlast()
      return
    }

    // Safety check: stop if max attempts reached
    if (pollingAttempts >= POLLING_MAX_ATTEMPTS) {
      log(`Polling max attempts reached for campaign ${campaignId}`)
      handleBlastError('POLLING_TIMEOUT', 'Polling timeout - campaign may still be processing')
      stopPollingCampaignStatus()
    }
  }

  /**
   * Stop polling and clean up interval.
   * CRITICAL: Must be called to prevent memory leaks.
   */
  function stopPollingCampaignStatus() {
    if (pollingIntervalId.value !== null) {
      window.clearInterval(pollingIntervalId.value)
      pollingIntervalId.value = null
    }

    pollingStatus.value = 'stopped'
    activePollingCampaignId.value = null
    pollingAttempts = 0

    log('Polling stopped')
  }

  /**
   * Handle campaign send initiated (before 202 response).
   * Sets up idempotency tracking.
   */
  function onCampaignSendInitiated(campaignId: string) {
    if (!canSubmitBlast(campaignId)) {
      return false
    }
    markSubmitted(campaignId)
    return true
  }

  /**
   * Handle 202 Accepted response - start polling.
   */
  function onCampaignAccepted(campaignId: string, response: CampaignStatusResponseDto) {
    // Initialize progress from response
    progressTracker.value = {
      totalRecipients: response.totalAudience,
      totalQueued: response.totalAudience,
      totalSent: 0,
      totalFailed: 0,
      totalPending: response.totalAudience,
      successRate: 0,
      estimatedCompletion: response.estimatedCompletion
        ? new Date(response.estimatedCompletion)
        : null,
      startedAt: new Date()
    }

    // Start polling
    startPollingCampaignStatus(campaignId)
  }

  // =============================================================================
  // OTHER ACTIONS
  // =============================================================================

  /**
   * Initialize blast configuration for a campaign.
   * Resets all state and sets up channel configurations.
   */
  function initializeBlast(campaignId: string, campaignName: string, channels: ChannelConfiguration[]) {
    // Stop any existing polling first
    stopPollingCampaignStatus()

    // CRITICAL: Clear idempotency on fresh init
    submittedCampaignIds.value.clear()
    activeBLASTS.value.clear()
    completedBLASTS.value = []
    failedBLASTS.value = []
    lastError.value = null

    currentConfig.value = {
      campaignId,
      campaignName,
      channels,
      selectedTemplateId: null,
      audienceIds: [],
      intervalMin: 1,
      intervalMax: 5
    }

    channelConfigurations.value = channels
    progressTracker.value = {
      totalRecipients: 0,
      totalQueued: 0,
      totalSent: 0,
      totalFailed: 0,
      totalPending: 0,
      successRate: 0,
      estimatedCompletion: null,
      startedAt: null
    }

    isInitializing.value = false
  }

  /**
   * Set active channel for the blast.
   * Enforces single-active-channel constraint.
   */
  function setActiveChannel(channelType: ChannelType) {
    channelConfigurations.value = channelConfigurations.value.map(c => ({
      ...c,
      isActive: c.channel === channelType
    }))
  }

  /**
   * Update template selection status.
   * Called after template validation from backend.
   */
  function updateTemplateStatus(status: TemplateSelectionStatus, templateId?: string) {
    templateSelectionStatus.value = status
    if (currentConfig.value && templateId) {
      currentConfig.value.selectedTemplateId = templateId
    }
  }

  /**
   * CRITICAL: Idempotency check before blast trigger.
   * Prevents double-submission from frontend network lag.
   */
  function canSubmitBlast(campaignId: string): boolean {
    if (submittedCampaignIds.value.has(campaignId)) {
      lastError.value = {
        code: 'DUPLICATE_SUBMISSION',
        message: `Campaign ${campaignId} has already been submitted`,
        timestamp: new Date()
      }
      return false
    }
    return true
  }

  /**
   * Mark campaign as submitted (idempotency key set).
   * Call this BEFORE making the API request.
   */
  function markSubmitted(campaignId: string) {
    submittedCampaignIds.value.add(campaignId)
    isBlasting.value = true
  }

  /**
   * Update progress from external source.
   */
  function updateProgress(update: Partial<ProgressTracker>) {
    progressTracker.value = {
      ...progressTracker.value,
      ...update
    }
  }

  /**
   * Record a single blast result (success or failure).
   */
  function recordBlastResult(task: BlastQueueTask, success: boolean) {
    activeBLASTS.value.delete(task.blastTaskId)

    if (success) {
      completedBLASTS.value = [...completedBLASTS.value, task]
    } else {
      failedBLASTS.value = [...failedBLASTS.value, task]
    }

    // Update progress counters
    updateProgress({
      totalSent: success ? progressTracker.value.totalSent + 1 : progressTracker.value.totalSent,
      totalFailed: success ? progressTracker.value.totalFailed : progressTracker.value.totalFailed + 1,
      totalPending: progressTracker.value.totalPending - 1
    })

    // Recalculate success rate
    const total = progressTracker.value.totalSent + progressTracker.value.totalFailed
    if (total > 0) {
      updateProgress({ successRate: (progressTracker.value.totalSent / total) * 100 })
    }
  }

  /**
   * Add task to active blasts (when queued).
   */
  function enqueueTask(task: BlastQueueTask) {
    const newMap = new Map(activeBLASTS.value)
    newMap.set(task.blastTaskId, task)
    activeBLASTS.value = newMap

    updateProgress({
      totalQueued: progressTracker.value.totalQueued + 1,
      totalPending: progressTracker.value.totalPending + 1
    })
  }

  /**
   * Handle blast error from infrastructure.
   */
  function handleBlastError(errorCode: string, errorMessage: string) {
    lastError.value = { code: errorCode, message: errorMessage, timestamp: new Date() }
  }

  /**
   * Complete the blast session and clean up.
   */
  function completeBlast() {
    isBlasting.value = false
    updateProgress({
      estimatedCompletion: new Date()
    })
  }

  /**
   * Reset store to initial state (for logout or navigation).
   * CRITICAL: Must clear polling interval to prevent memory leaks.
   */
  function $reset() {
    // Stop polling first (critical!)
    stopPollingCampaignStatus()

    currentConfig.value = null
    channelConfigurations.value = []
    templateSelectionStatus.value = TemplateSelectionStatus.UNSELECTED
    progressTracker.value = {
      totalRecipients: 0,
      totalQueued: 0,
      totalSent: 0,
      totalFailed: 0,
      totalPending: 0,
      successRate: 0,
      estimatedCompletion: null,
      startedAt: null
    }
    activeBLASTS.value.clear()
    completedBLASTS.value = []
    failedBLASTS.value = []
    submittedCampaignIds.value.clear()
    lastError.value = null
    isInitializing.value = false
    isBlasting.value = false
    pollingStatus.value = 'idle'
  }

  // =============================================================================
  // HELPER
  // =============================================================================

  function log(message: string, ...args: any[]) {
    if (import.meta.env.DEV) {
      console.log(`[BlastCampaignStore] ${message}`, ...args)
    }
  }

  // =============================================================================
  // RETURN STATE AND ACTIONS
  // =============================================================================

  return {
    // State
    currentConfig,
    channelConfigurations,
    templateSelectionStatus,
    progressTracker,
    activeBLASTS,
    completedBLASTS,
    failedBLASTS,
    lastError,
    isInitializing,
    isBlasting,

    // Polling state
    activePollingCampaignId,
    pollingStatus,

    // Computed
    activeChannel,
    pendingBlastCount,
    isBlastInProgress,
    currentProgress,
    estimatedTimeRemaining,

    // Actions
    initializeBlast,
    setActiveChannel,
    updateTemplateStatus,
    canSubmitBlast,
    markSubmitted,
    updateProgress,
    recordBlastResult,
    enqueueTask,
    handleBlastError,
    completeBlast,

    // Polling actions
    startPollingCampaignStatus,
    stopPollingCampaignStatus,
    pollCampaignStatus,
    onCampaignSendInitiated,
    onCampaignAccepted,

    // Reset
    $reset
  }
}, {
  persist: false  // Security: never persist blast state to localStorage
})