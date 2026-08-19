// 後台權限唯一規格：角色、模組與禁止事項集中於此。
// Worker 負責資料庫範圍驗證；前端只讀取 capabilities 決定顯示，不作為安全邊界。

export const ADMIN_CAPABILITIES = Object.freeze({
  platform_super_admin: Object.freeze({
    canOperateSeries: true,
    canManageRegistrations: true,
    canManageSessions: true,
    canManageSeating: true,
    canManageFinance: true,
    canManageOnsite: true,
    canManageCommunications: true,
    canManageMembers: true,
    canManageTenantSettings: true,
    canManageStaff: true,
    canDelete: true,
    canPlatform: true,
  }),
  organizer_owner: Object.freeze({
    canOperateSeries: true,
    canManageRegistrations: true,
    canManageSessions: true,
    canManageSeating: true,
    canManageFinance: true,
    canManageOnsite: true,
    canManageCommunications: true,
    canManageMembers: true,
    canManageTenantSettings: true,
    canManageStaff: true,
    canDelete: false,
    canPlatform: false,
  }),
  organizer_admin: Object.freeze({
    canOperateSeries: true,
    canManageRegistrations: true,
    canManageSessions: true,
    canManageSeating: true,
    canManageFinance: true,
    canManageOnsite: true,
    canManageCommunications: true,
    canManageMembers: true,
    canManageTenantSettings: false,
    canManageStaff: false,
    canDelete: false,
    canPlatform: false,
  }),
  session_admin: Object.freeze({
    canOperateSeries: true,
    canManageRegistrations: true,
    canManageSessions: true,
    canManageSeating: true,
    canManageFinance: false,
    canManageOnsite: true,
    canManageCommunications: true,
    canManageMembers: false,
    canManageTenantSettings: false,
    canManageStaff: false,
    canDelete: false,
    canPlatform: false,
  }),
  finance_admin: Object.freeze({
    canOperateSeries: true,
    canManageRegistrations: false,
    canManageSessions: false,
    canManageSeating: false,
    canManageFinance: true,
    canManageOnsite: false,
    canManageCommunications: false,
    canManageMembers: false,
    canManageTenantSettings: false,
    canManageStaff: false,
    canDelete: false,
    canPlatform: false,
  }),
  onsite_staff: Object.freeze({
    canOperateSeries: true,
    canManageRegistrations: false,
    canManageSessions: false,
    canManageSeating: false,
    canManageFinance: false,
    canManageOnsite: true,
    canManageCommunications: false,
    canManageMembers: false,
    canManageTenantSettings: false,
    canManageStaff: false,
    canDelete: false,
    canPlatform: false,
  }),
});

export const DESTRUCTIVE_ADMIN_ACTIONS = new Set([
  'deleteEvent', 'deleteSession', 'deleteBundle', 'deleteAnnouncement',
  'deleteSessionVisualAsset', 'deleteFinanceItem', 'deleteSeatCustomMarker',
  'deletePhotoFrame', 'deleteVenueMap', 'removeStaff', 'purgeErrorLogs',
  'voidMemberCredit',
]);

export const PLATFORM_ADMIN_ACTIONS = new Set([
  'applyList', 'getTenantsAdmin', 'approveApply', 'lockTenant', 'unlockTenant',
  'generateSessionVisual', 'setSessionMainVisual', 'deleteSessionVisualAsset',
  'deleteEvent', 'deleteSession', 'deleteBundle', 'deleteAnnouncement',
  'unlockFinanceSettlement',
  'saveOperationShareSetting', 'saveFinanceShare',
  'socialBootstrap', 'socialListPartners', 'socialSavePartner',
  'socialListCampaigns', 'socialGetCampaign', 'socialCalendar',
  'socialMetaStatus', 'socialCreateCampaign', 'socialGenerateCampaign',
  'socialUpdatePost', 'socialRegeneratePost', 'socialRegenerateHashtags',
  'socialRegenerateImagePrompt', 'socialUploadPostImage', 'socialDeletePostImage',
  'socialScheduleCampaign', 'socialCancelPost', 'socialRetryPost',
  'socialSelectMetaAccounts', 'socialMetaDisconnect', 'socialThreadsDisconnect',
]);

export const TENANT_OWNER_ACTIONS = new Set([
  'getErrorLogs', 'purgeErrorLogs', 'getStaff', 'addStaff', 'removeStaff',
  'setStaffActive', 'updateStaffPerms', 'updateStaffSessions', 'updateStaffScope',
  'setStaffScope', 'getPaymentSettings', 'savePaymentSettings',
  'savePaymentProfile', 'disablePaymentProfile', 'getEmailTemplates',
  'saveEmailTemplate', 'getCompanySettings', 'saveCompanySettings', 'saveSiteConfig',
  'getOfficialGroupSettings', 'saveOfficialGroupSettings',
  'getPhotoActivityAdminConfig',
  'saveAgreementTemplate', 'saveAgreementTemplates', 'listVenueMaps',
  'saveVenueMap', 'deleteVenueMap', 'saveMemberCategory', 'adjustMemberCredit',
  'voidMemberCredit', 'setFastPass', 'testEmail', 'createEvent',
  'saveAnnouncement',
  'listContactLeads',
]);

// organizer_admin 可完整操作「被指定系列」的業務，但不能跨系列、刪除、管理租戶或平台。
export const SERIES_MANAGER_ACTIONS = new Set([
  'adminLogout', 'getDashboard', 'adminBusinessOverview', 'financeOverview',
  'getOperationsReport', 'adminFinanceAnomalies', 'getSessionDashboard',
  'getAdminSessionsDashboard', 'getAdminSessionDashboard', 'getTodos',
  'getSessionRegistrations', 'getSessionEquipmentDetails', 'getFinancePaymentGroups',
  'getPaymentProfiles', 'getAgreementTemplate', 'getAgreementTemplates',
  'getMembers', 'getMemberHistory', 'downloadSession', 'getRegs', 'getRegsBySession',
  'onsiteSessions', 'onsiteRegs', 'onsiteDaySummary', 'opsDashboard',
  'onsitePasscodeList', 'getEventsAdmin', 'getSessionsAdmin',
  'getPayments', 'getFinance', 'getSessionFinanceReport', 'accountingReport',
  'adminManualSession', 'getInvoiceList', 'getForceRefundList',
  'previewForceCancelSession', 'createShortLink', 'getBundles', 'saveBundle',
  'saveMemberNote', 'saveSeatMap', 'adminSeatBoard', 'syncSeatRoster',
  'saveSeatMarkerPosition', 'saveSeatMarkerPositions', 'saveSeatBoardConfig',
  'saveSeatCustomMarker', 'publishSeatLayout', 'adminAssignSeat', 'runBatchAssign',
  'saveSeatMapImage', 'updateEvent',
  'createSession', 'updateSession', 'uploadCover', 'toggleSession',
  'toggleSessionStatus', 'copySession', 'updateRegStatus', 'batchUpdateStatus',
  'approveReg', 'confirmPayment', 'markPaymentScreenshot', 'saveRegNote',
  'sendPaymentReminder', 'adminCancelReg', 'refundDeposit', 'checkin', 'onsiteMark',
  'previewRegistrationResolution', 'resolveRegistration', 'partialDayRefund',
  'adminPreviewRegistration', 'adminCreateRegistration',
  'onsitePasscodeGenerate', 'onsitePasscodeToggle', 'markClear', 'sendNotify',
  'resendInvite', 'resendRegConfirm', 'createFinanceShare',
  'lockFinanceSettlement', 'saveFinanceItem',
  'updateInvoiceStatus', 'listPhotoFrames', 'savePhotoFrame', 'listPhotoLeads',
  'applyVenueMap', 'updateRegistrationAction', 'forceCancelSession',
  'runForceChoiceDeadline', 'confirmForceRefund', 'confirmRefund', 'getRefundSuggestion',
]);

export const SESSION_TARGET_ACTIONS = new Set([
  'createShortLink', 'getSessionDashboard', 'getAdminSessionDashboard',
  'getSessionRegistrations', 'getSessionEquipmentDetails', 'downloadSession',
  'getRegsBySession', 'onsiteRegs', 'onsiteDaySummary', 'adminManualSession',
  'getSessionFinanceReport', 'previewForceCancelSession', 'saveBundle',
  'getInvoiceList',
  'saveSeatMap', 'adminSeatBoard', 'syncSeatRoster', 'saveSeatMarkerPosition',
  'saveSeatMarkerPositions', 'saveSeatBoardConfig', 'saveSeatCustomMarker',
  'publishSeatLayout', 'adminAssignSeat', 'runBatchAssign', 'saveSeatMapImage',
  'createSession', 'updateSession', 'uploadCover', 'toggleSession',
  'toggleSessionStatus', 'copySession', 'adminPreviewRegistration',
  'adminCreateRegistration', 'onsitePasscodeGenerate', 'onsitePasscodeToggle',
  'saveOperationShareSetting', 'saveFinanceShare', 'createFinanceShare',
  'lockFinanceSettlement', 'saveFinanceItem', 'applyVenueMap', 'forceCancelSession',
  'runForceChoiceDeadline', 'getRefundSuggestion',
]);

export const REGISTRATION_TARGET_ACTIONS = new Set([
  'updateRegStatus', 'approveReg', 'confirmPayment', 'markPaymentScreenshot',
  'saveRegNote', 'sendPaymentReminder', 'adminCancelReg', 'refundDeposit',
  'checkin', 'onsiteMark', 'previewRegistrationResolution', 'resolveRegistration',
  'partialDayRefund', 'updateInvoiceStatus',
  'updateRegistrationAction', 'resendRegConfirm', 'confirmForceRefund',
  'confirmRefund', 'markClear', 'resendInvite', 'sendNotify',
]);

export function capabilitiesForRole(role) {
  const key = String(role || '').trim();
  return { ...(ADMIN_CAPABILITIES[key] || {}) };
}

export function selectActivePlatformAdminRecord(platformRows = [], staffRows = []) {
  const isActive = row => !!row && (row.is_active !== undefined ? row.is_active !== false : row.active !== false);
  const platformRecord = (platformRows || []).find(isActive);
  if (platformRecord) return { ...platformRecord, source: 'platform_staff' };
  const staffRecord = (staffRows || []).find(row =>
    isActive(row) && String(row.normalized_role || row.role || '').trim() === 'platform_super_admin'
  );
  return staffRecord ? { ...staffRecord, source: 'staff' } : null;
}

export function isDestructiveAdminAction(action) {
  return DESTRUCTIVE_ADMIN_ACTIONS.has(String(action || ''));
}

export function isSeriesManagerAction(action) {
  return SERIES_MANAGER_ACTIONS.has(String(action || ''));
}
