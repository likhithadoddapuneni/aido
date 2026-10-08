/**
 * What a person sees for each error the API can return. Written as guidance, not as a diagnosis: say what
 * happened and what to do next, in plain words, without blaming the user and without internals.
 */
export const errorsEn = {
  // --- the request itself ---
  validation_failed: 'Some details need fixing. Please check the highlighted fields.',
  bad_request: 'We could not understand that request. Please try again.',
  not_found: 'We could not find that.',
  route_not_found: 'That page does not exist.',
  invalid_cursor: 'That list is out of date. Please refresh.',
  rate_limited: 'Too many attempts. Please wait a moment and try again.',
  internal_error: 'Something went wrong on our side. Please try again in a moment.',
  app_version_unsupported: 'Please update the app to continue.',
  idempotency_key_required: 'Something went wrong sending that. Please try again.',
  idempotency_key_reuse:
    'That request was already sent with different details. Please start again.',
  request_in_progress: 'That is already being processed. Please wait a moment.',

  // --- signing in ---
  unauthorized: 'Please sign in to continue.',
  invalid_token: 'Your session has ended. Please sign in again.',
  invalid_refresh_token: 'Your session has ended. Please sign in again.',
  forbidden: 'You do not have access to this.',
  registration_required:
    'Please sign in or create an account to continue. Nothing you have done will be lost.',
  invalid_code: 'That code is not right or has expired. Please request a new one.',
  invalid_credentials: 'Those details are not right. Please check them and try again.',
  invalid_id_token: 'We could not verify that sign-in. Please try again.',
  oauth_not_configured: 'That sign-in method is not available yet.',
  weak_password: 'Please choose a longer, less common password.',
  email_in_use: 'An account with that email already exists.',
  consent_required: 'Please accept the terms to continue.',
  terms_required: 'Please accept the terms to continue.',
  no_credential: 'This account is not set up yet. Please use your invitation link.',
  invalid_invite: 'This invitation is invalid or has expired. Please ask for a new one.',
  invitation_pending: 'An invitation has already been sent to this person.',
  mfa_enrolment_required: 'Please set up two-step verification to continue.',
  mfa_already_enrolled: 'Two-step verification is already set up.',
  mfa_not_pending: 'There is no two-step setup in progress.',

  // --- projects and recommendations ---
  invalid_project: 'Please check your room details and try again.',
  path_change_not_allowed: 'To change what you are furnishing, please start a new project.',
  not_a_room_project: 'This project is not for a single room.',
  use_ranking: 'This project ranks individual products rather than building a room.',
  use_recommend: 'This project builds a complete room. Please generate recommendations instead.',
  unknown_slot: 'That item is not part of this room.',
  item_not_found: 'That item is not part of this selection.',
  essential_item: 'This item is essential to the room and cannot be removed.',
  replacement_not_available: 'That product is not available as a replacement here.',
  composition_invalid:
    'That change would stop this room working as a whole. Please choose a different product.',
  composition_stale:
    'Prices or availability have changed. Please refresh your recommendations to continue.',
  composition_empty: 'There is nothing in this selection to buy.',
  composition_not_buyable: 'This selection is no longer available to buy.',
  below_min_match: 'That product is not a good enough match for your room.',
  fails_fit: 'That product will not fit your room.',
  compat_map_not_approved: 'Recommendations are not available right now. Please try again later.',
  compat_map_mismatch: 'Recommendations are not available right now. Please try again later.',

  // --- checkout and payment ---
  checkout_blocked: 'One of your items is no longer available. Please review your selection.',
  checkout_changed:
    'Your total changed while you were paying. Please review it and try again. You have not been charged.',
  checkout_not_approvable: 'This checkout can no longer be changed.',
  conflicting_lines:
    'The same product appears twice with different prices. Please review your basket.',
  empty_order: 'Your basket is empty.',
  nothing_to_pay: 'There is nothing to pay for this order.',
  not_validated: 'We are still checking availability with the sellers. Please wait a moment.',
  awaiting_seller_confirmation:
    'We are waiting for a seller to confirm availability. We will tell you as soon as they do.',
  seller_validation_failed: 'A seller could not confirm an item. Please choose another product.',
  price_approval_required: 'A price changed. Please review and approve the new total to continue.',
  total_changed: 'Prices changed again. Please review the new total before approving.',
  reservation_expired:
    'The 24-hour purchase window has ended. Please check availability again to continue.',
  payment_declined: 'Your payment was not accepted. Please try another card.',
  payment_in_progress: 'A payment for this order is already in progress.',
  payment_superseded: 'A newer payment attempt replaced this one.',
  payment_awaiting_authentication:
    'Please complete the verification with your bank to finish paying.',
  payment_capture_failed: 'We could not complete the payment. You have not been charged.',
  payment_closed: 'This payment was cancelled. Please start again.',
  payment_not_authorised: 'This payment was not authorised. Please try again.',
  payment_provider_unavailable:
    'Our payment provider did not respond. Please retry. You will not be charged twice.',
  order_could_not_be_placed:
    'We could not place your order and have refunded your payment in full.',
  amount_mismatch: 'The amount changed. Please review your total and try again.',
  not_covered: 'Your deposit does not cover this order.',
  invalid_webhook_signature: 'That notification could not be verified.',
  authentication_failed: 'Card verification failed. Please try again or use another card.',
  processor_error: 'The payment could not be processed. Please try again.',
  authorization_expired: 'The payment authorisation expired. Please try again.',
  authorization_voided: 'The payment authorisation was cancelled. Please try again.',
  unknown_authorization: 'We could not find that payment. Please try again.',
  amount_exceeds_authorization: 'The amount is higher than was authorised.',
  amount_exceeds_captured: 'The refund is higher than the amount paid.',
  already_captured: 'This payment was already taken.',
  not_captured: 'This payment has not been taken yet.',
  refund_exceeds_paid: 'The refund is higher than the amount paid.',
  partial_refund_unsupported: 'Partial refunds are not available yet. Please contact support.',

  // --- viewings ---
  viewing_items_unavailable: 'Some of those products cannot be viewed in store right now.',
  empty_viewing: 'Choose at least one product to view.',
  viewing_closed: 'This viewing is no longer open.',
  viewing_not_active: 'This viewing is no longer active.',
  viewing_not_cancellable: 'This viewing can no longer be cancelled.',
  viewing_not_awaiting_confirmation: 'This viewing is not waiting for a seller.',
  viewing_not_awaiting_deposit: 'The deposit is not due for this viewing.',
  viewing_no_decision_pending: 'There is nothing to decide for this viewing.',
  viewing_pass_unavailable:
    'Your viewing pass is not available yet. It appears once the deposit is paid.',
  deposit_payment_in_progress: 'A deposit payment is already in progress.',
  invalid_schedule: 'Please choose a time in the future.',
  pass_invalid: 'This viewing pass is not valid.',
  already_checked_in: 'This visitor has already been checked in.',
  not_checked_in: 'This visitor has not been checked in yet.',
  not_on_display: 'This item is not on display at the moment.',
  outcome_already_recorded: 'The result of this viewing has already been recorded.',

  // --- orders, issues, fulfilment ---
  issue_already_open: 'You have already reported this problem. We are looking into it.',
  issue_closed: 'This problem has already been closed.',
  line_closed: 'This item can no longer be changed.',
  open_issue_blocks_line: 'There is an open problem with this item. Please resolve it first.',
  proof_of_delivery_required: 'Please add a delivery photo before marking this delivered.',
  too_many_photos: 'You can add up to five photos.',
  photo_position_taken: 'That photo slot is already used.',
  illegal_transition: 'That change is not allowed at this stage.',

  // --- sellers: catalogue, imports, team ---
  duplicate_sku: 'You already have a product with that SKU.',
  duplicate_listing: 'You already list this product at this showroom.',
  offer_version_conflict: 'Someone else changed this offer. Please refresh and try again.',
  stock_below_reserved: 'You cannot lower stock below what customers are currently holding.',
  availability_conflicts_with_stock: 'Availability and stock quantity do not match.',
  original_price_below_selling: 'The original price must not be lower than the selling price.',
  product_data_invalid: 'Some product details need fixing.',
  product_incomplete: 'This product is missing required details.',
  product_not_verified: 'This product has not been verified yet.',
  invalid_product_value: 'One of the product values is not allowed.',
  invalid_location: 'Please choose one of your showrooms.',
  location_geo_incomplete: 'Please give both latitude and longitude, or neither.',
  location_inactive: 'This showroom is closed.',
  location_has_live_offers: 'This showroom still has live products. Move or deactivate them first.',
  location_has_viewings:
    'This showroom has upcoming viewings. Please complete or cancel them first.',
  partner_inactive: 'This seller account is not active.',
  invalid_storage_key: 'That upload is not valid.',
  upload_not_found: 'We could not find that upload. Please upload it again.',
  media_storage_not_configured: 'Photo uploads are not available right now.',
  csv_empty: 'That file has no rows.',
  csv_header_invalid: 'That file does not match the template. Please download the latest template.',
  csv_malformed: 'That file could not be read. Please save it as CSV and try again.',
  import_too_large: 'That file has too many rows. Please split it into smaller files.',
  import_not_committable: 'This import cannot be applied. Please fix the errors first.',
  import_chunk_failed: 'Part of the import failed, so nothing was changed. Please try again.',
  last_owner: 'There must always be at least one owner.',
  last_admin: 'There must always be at least one administrator.',

  // --- operations ---
  activation_preconditions: 'This seller cannot be activated yet. Please complete the checklist.',
  undelivered_lines: 'This seller still has undelivered orders.',
  run_not_draft: 'This settlement run is no longer a draft.',
  run_not_approved: 'This settlement run has not been approved.',
  run_stale: 'This settlement run is out of date. Please create a new one.',
  version_not_deployed: 'That version is not the one currently deployed.',
  version_retired: 'That version has been retired.',
  task_already_answered: 'This confirmation has already been answered.',
} as const;

export type ErrorCode = keyof typeof errorsEn;
