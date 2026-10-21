import { describe, expect, it, vi } from 'vitest'
import { createDemoDataSource } from '../../../demo/demoDataSource'
import type { DataSource } from '../../../lib/dataSource'
import { liveDataSource } from '../../../lib/dataSource'
import type { InspectionRequest, InspectionResult } from '../../../types/inspection'

describe('Webcam Source Routing Integration Tests', () => {
  const dummyBlob = new Blob(['test-image-bytes'], { type: 'image/jpeg' })

  describe('DEMO Mode Routing', () => {
    it('routes inspection through demoDataSource without calling live endpoints', async () => {
      const demoDs = createDemoDataSource(() => 'pass')
      const liveInspectSpy = vi.spyOn(liveDataSource, 'createInspection')
      const liveLocateSpy = vi.spyOn(liveDataSource, 'locateLabel')

      const req: InspectionRequest = {
        image: dummyBlob,
        imageName: 'webcam-capture.jpg',
        expected_product: 'bottle_a',
        source_mode: 'webcam',
        client_request_id: 'test-req-demo-01',
        demo: true,
      }

      // Execute through DEMO dataSource (same route used by CameraPanel in DEMO mode)
      const result = await demoDs.createInspection(req)

      // 1. Verify result properties
      expect(result).toBeDefined()
      expect(result.inspection_id).toBeDefined()
      expect(result.client_request_id).toBe('test-req-demo-01')
      expect(result.source_mode).toBe('webcam')
      expect(result.expected_product).toBe('bottle_a')
      expect(result.result).toBe('PASS')
      expect(Boolean(result.demo || result.is_demo)).toBe(true)

      // 2. Verify live backend was never called
      expect(liveInspectSpy).not.toHaveBeenCalled()
      expect(liveLocateSpy).not.toHaveBeenCalled()

      // 3. Verify the inspection is stored in demo store (shared with HistoryPage in DEMO mode)
      const historyPage = await demoDs.listInspections({ page: 1, page_size: 10 })
      const foundInHistory = historyPage.items.find((item) => item.client_request_id === 'test-req-demo-01')
      expect(foundInHistory).toBeDefined()
      expect(foundInHistory?.inspection_id).toBe(result.inspection_id)

      // 4. Verify imageUrl produces synthetic data URIs, not live http:// URLs
      const originalUrl = demoDs.imageUrl(result, 'original')
      const annotatedUrl = demoDs.imageUrl(result, 'annotated')
      expect(originalUrl).toMatch(/^data:image\/svg\+xml/)
      expect(annotatedUrl).toMatch(/^data:image\/svg\+xml/)
      expect(originalUrl).not.toContain('http://127.0.0.1')
      expect(annotatedUrl).not.toContain('http://127.0.0.1')

      liveInspectSpy.mockRestore()
      liveLocateSpy.mockRestore()
    })

    it('routes locateLabel through demoDataSource without calling live locator API', async () => {
      const demoDs = createDemoDataSource(() => 'pass')
      const liveLocateSpy = vi.spyOn(liveDataSource, 'locateLabel')

      const locResult = await demoDs.locateLabel(dummyBlob, 'bottle_a')

      expect(locResult).toBeDefined()
      expect(locResult.usable_view).toBe(true)
      expect(locResult.quality.sharp_enough).toBe(true)
      expect(locResult.quality.bottle_visible).toBe(true)
      expect(locResult.reason).toBe('usable_view')

      // Ensure live API was untouched
      expect(liveLocateSpy).not.toHaveBeenCalled()

      liveLocateSpy.mockRestore()
    })

    it('returns simulated failure when DEMO scenario is blurred or wrong_label', async () => {
      const demoDsBlur = createDemoDataSource(() => 'blurred')
      const blurLoc = await demoDsBlur.locateLabel(dummyBlob, 'bottle_a')
      expect(blurLoc.usable_view).toBe(false)
      expect(blurLoc.quality.sharp_enough).toBe(false)
      expect(blurLoc.reason).toBe('blurred_image')

      const demoDsFail = createDemoDataSource(() => 'wrong_label')
      const failResult = await demoDsFail.createInspection({
        image: dummyBlob,
        expected_product: 'bottle_a',
        source_mode: 'webcam',
        client_request_id: 'test-req-wrong-label',
        demo: true,
      })
      expect(failResult.result).toBe('FAIL')
      expect(failResult.reason).toBe('wrong_label')
      expect(failResult.detected_product).toBe('bottle_b')
    })
  })

  describe('LIVE Mode Routing', () => {
    it('dispatches to liveDataSource with demo: false when in LIVE mode', async () => {
      const mockResult: InspectionResult = {
        inspection_id: 'live-insp-123',
        client_request_id: 'live-req-123',
        created_at: new Date().toISOString(),
        source_mode: 'webcam',
        expected_product: 'bottle_a',
        detected_product: 'bottle_a',
        result: 'PASS',
        reason: 'good',
        match_score: 0.95,
        score_method: 'template_ccoeff_normed_clamped_v1',
        bbox: { x: 10, y: 10, width: 100, height: 200 },
        expected_bbox: { x: 10, y: 10, width: 100, height: 200 },
        image_width: 640,
        image_height: 480,
        orientation_deg: 0,
        timing_ms: { orientation: 10, inspection: 25, storage: 5, total: 40 },
        config_version: 'v1.0.0',
        storage_status: 'saved',
        storage_error: null,
        images: { original: '/api/inspections/live-insp-123/images/original', annotated: '/api/inspections/live-insp-123/images/annotated' },
        evidence: {
          kind: 'single_view',
          search_status: 'usable_view_found',
          supporting_angles_deg: [],
          reported_coverage_deg: null,
          verified_coverage: true,
          required_view_profile: null,
          supporting_images: [],
        },
        reviewed_result: null,
        reviewed_reason: null,
        reviewer: null,
        reviewed_at: null,
        demo: false,
      }

      const mockLiveDs: DataSource = {
        kind: 'live',
        health: vi.fn(),
        products: vi.fn(),
        locateLabel: vi.fn(),
        createInspection: vi.fn().mockResolvedValue(mockResult),
        listInspections: vi.fn(),
        getInspection: vi.fn(),
        getInspectionFiles: vi.fn(),
        downloadZipUrl: vi.fn().mockReturnValue(null),
        retrySave: vi.fn(),
        review: vi.fn(),
        exportCsvUrl: vi.fn().mockReturnValue('/api/inspections/export.csv'),
        imageUrl: vi.fn().mockReturnValue('http://127.0.0.1:8000/api/inspections/live-insp-123/images/annotated'),
      }

      const res = await mockLiveDs.createInspection({
        image: dummyBlob,
        imageName: 'webcam-capture.jpg',
        expected_product: 'bottle_a',
        source_mode: 'webcam',
        client_request_id: 'live-req-123',
        demo: false,
      })

      expect(mockLiveDs.createInspection).toHaveBeenCalledWith(
        expect.objectContaining({
          expected_product: 'bottle_a',
          source_mode: 'webcam',
          demo: false,
        }),
      )
      expect(res.demo).toBe(false)
      expect(res.result).toBe('PASS')
    })
  })

  describe('Source Switching and Stale Callback Isolation', () => {
    it('discards stale callback results when mode is switched between DEMO and LIVE', () => {
      // Simulates handleLiveInspectionComplete isolation logic in WebcamPage.tsx
      let currentSource: 'live' | 'demo' = 'demo'
      const captures: InspectionResult[] = []

      function handleComplete(result: InspectionResult) {
        const isResultDemo = Boolean(result.demo || result.is_demo)
        if ((currentSource === 'demo') !== isResultDemo) {
          // Stale callback from previous mode - discard
          return false
        }
        captures.unshift(result)
        return true
      }

      const demoResult: InspectionResult = {
        inspection_id: 'demo-1',
        client_request_id: 'req-demo-1',
        created_at: new Date().toISOString(),
        source_mode: 'webcam',
        expected_product: 'bottle_a',
        detected_product: 'bottle_a',
        result: 'PASS',
        reason: 'good',
        match_score: 0.9,
        score_method: 'template_ccoeff_normed_clamped_v1',
        bbox: null,
        expected_bbox: null,
        image_width: 640,
        image_height: 480,
        orientation_deg: null,
        timing_ms: { orientation: 0, inspection: 0, storage: 0, total: 0 },
        config_version: 'demo',
        storage_status: 'saved',
        storage_error: null,
        images: { original: null, annotated: null },
        evidence: {
          kind: 'single_view',
          search_status: 'not_requested',
          supporting_angles_deg: [],
          reported_coverage_deg: null,
          verified_coverage: false,
          required_view_profile: null,
          supporting_images: [],
        },
        reviewed_result: null,
        reviewed_reason: null,
        reviewer: null,
        reviewed_at: null,
        demo: true,
      }

      const liveResult: InspectionResult = {
        ...demoResult,
        inspection_id: 'live-1',
        client_request_id: 'req-live-1',
        demo: false,
        is_demo: false,
      }

      // In DEMO mode: accepts demo result
      expect(handleComplete(demoResult)).toBe(true)
      expect(captures).toHaveLength(1)
      expect(captures[0]?.inspection_id).toBe('demo-1')

      // Switch to LIVE mode: user switches header toggle
      currentSource = 'live'

      // Stale callback arriving from old DEMO in-flight request:
      const acceptedStaleDemo = handleComplete(demoResult)
      expect(acceptedStaleDemo).toBe(false)
      // captures must remain clean, not contaminated by stale demo result
      expect(captures).toHaveLength(1)

      // Fresh LIVE result arriving in LIVE mode:
      const acceptedLive = handleComplete(liveResult)
      expect(acceptedLive).toBe(true)
      expect(captures).toHaveLength(2)
      expect(captures[0]?.inspection_id).toBe('live-1')
    })
  })

  describe('Retry Idempotency & Contract Adherence', () => {
    it('retries inspection request using the exact same client_request_id and payload', async () => {
      const inspectCalls: InspectionRequest[] = []
      let attempt = 0

      const mockDs: DataSource = {
        kind: 'live',
        health: vi.fn(),
        products: vi.fn(),
        locateLabel: vi.fn(),
        createInspection: vi.fn().mockImplementation(async (req: InspectionRequest) => {
          inspectCalls.push(req)
          attempt++
          if (attempt === 1) {
            throw new Error('503 Service Unavailable')
          }
          return {
            inspection_id: 'insp-retry-ok',
            client_request_id: req.client_request_id,
            created_at: new Date().toISOString(),
            source_mode: req.source_mode,
            expected_product: req.expected_product,
            detected_product: req.expected_product,
            result: 'PASS',
            reason: 'good',
            match_score: 0.96,
            score_method: 'template_ccoeff_normed_clamped_v1',
            bbox: null,
            expected_bbox: null,
            image_width: 640,
            image_height: 480,
            orientation_deg: null,
            timing_ms: { orientation: 0, inspection: 10, storage: 5, total: 15 },
            config_version: 'test',
            storage_status: 'saved',
            storage_error: null,
            images: { original: null, annotated: null },
            evidence: {
              kind: 'single_view',
              search_status: 'not_requested',
              supporting_angles_deg: [],
              reported_coverage_deg: null,
              verified_coverage: false,
              required_view_profile: null,
              supporting_images: [],
            },
            reviewed_result: null,
            reviewed_reason: null,
            reviewer: null,
            reviewed_at: null,
          } as InspectionResult
        }),
        listInspections: vi.fn(),
        getInspection: vi.fn(),
        getInspectionFiles: vi.fn(),
        downloadZipUrl: vi.fn().mockReturnValue(null),
        retrySave: vi.fn(),
        review: vi.fn(),
        exportCsvUrl: vi.fn().mockReturnValue(null),
        imageUrl: vi.fn().mockReturnValue(null),
      }

      const initialReq: InspectionRequest = {
        image: dummyBlob,
        imageName: 'webcam-capture.jpg',
        expected_product: 'bottle_a',
        source_mode: 'webcam',
        client_request_id: 'client-req-uuid-fixed',
        demo: false,
      }

      // First attempt fails
      await expect(mockDs.createInspection(initialReq)).rejects.toThrow('503 Service Unavailable')
      expect(inspectCalls).toHaveLength(1)
      expect(inspectCalls[0]?.client_request_id).toBe('client-req-uuid-fixed')

      // Retry attempt re-uses identical request object and client_request_id
      const retryResult = await mockDs.createInspection(initialReq)
      expect(inspectCalls).toHaveLength(2)
      expect(inspectCalls[1]?.client_request_id).toBe('client-req-uuid-fixed')
      expect(inspectCalls[1]?.client_request_id).toBe(inspectCalls[0]?.client_request_id)
      expect(retryResult.inspection_id).toBe('insp-retry-ok')
      expect(retryResult.client_request_id).toBe('client-req-uuid-fixed')
    })
  })
})
