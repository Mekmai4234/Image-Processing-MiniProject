"""Synthetic clutter/perspective regressions; no private camera frames in Git."""
import io
from uuid import uuid4

import cv2
import numpy as np
from PIL import Image

from test_reference_setup import client, bottle_image


def png(image):
    stream = io.BytesIO()
    Image.fromarray(image).save(stream, format='PNG')
    return stream.getvalue()


def label_pattern(seed=14):
    rng = np.random.default_rng(seed)
    image = np.full((150, 168, 3), (215, 233, 245), np.uint8)
    for _ in range(45):
        x, y = rng.integers(5, 145, 2)
        color = tuple(int(v) for v in rng.integers(10, 200, 3))
        cv2.circle(image, (int(x), int(y)), int(rng.integers(2, 9)), color, -1)
    cv2.putText(image, 'VISION', (7, 58), cv2.FONT_HERSHEY_SIMPLEX, .75, (5, 20, 90), 2)
    cv2.putText(image, '600 ml', (14, 117), cv2.FONT_HERSHEY_SIMPLEX, .65, (10, 30, 130), 2)
    return image


def scene(label):
    image = np.random.default_rng(4).integers(90, 190, (360, 640, 3), dtype=np.uint8)
    cv2.rectangle(image, (30, 15), (130, 345), (25, 30, 40), -1)
    cv2.circle(image, (555, 100), 65, (230, 235, 240), -1)
    corners = np.float32([[0, 0], [167, 0], [167, 149], [0, 149]])
    target = np.float32([[220, 60], [450, 50], [465, 275], [210, 290]])
    matrix = cv2.getPerspectiveTransform(corners, target)
    patch = cv2.warpPerspective(label, matrix, (640, 360))
    mask = cv2.warpPerspective(np.full(label.shape[:2], 255, np.uint8), matrix, (640, 360))
    image[mask > 0] = patch[mask > 0]
    return image


def enroll(client):
    reference = cv2.resize(bottle_image(), (480, 720))
    reference[290:440, 156:324] = label_pattern()
    response = client.post('/api/reference-profile', data={
        'product_id': 'bottle_a', 'name': 'Synthetic textured label',
        'crop': '[0.325,0.402777778,0.35,0.208333333]', 'acknowledge_experimental': 'true'},
        files={'image': ('synthetic.png', png(reference), 'image/png')})
    assert response.status_code == 200, response.text


def test_webcam_cluttered_closeup_locator_and_saved_inspection(client):
    enroll(client)
    frame = scene(label_pattern())
    for width in (640, 480):
        image = cv2.resize(frame, (width, round(width * 360 / 640)))
        location = client.post('/api/locate-label', data={'expected_product': 'bottle_a'},
                               files={'image': ('frame.png', png(image), 'image/png')})
        assert location.status_code == 200, location.text
        location = location.json()
        assert location['usable_view'], location
        assert location['quality']['label_visible'] and location['quality']['sharp_enough']
        assert location['quality']['bottle_visible'] is False
        assert 0 <= location['bbox']['x'] < width and location['bbox']['width'] > width * .25
    response = client.post('/api/inspections', data={'expected_product': 'bottle_a',
        'source_mode': 'webcam', 'demo': 'false', 'client_request_id': str(uuid4())},
        files={'image': ('frame.png', png(frame), 'image/png')})
    assert response.status_code == 200, response.text
    record = response.json()
    assert (record['result'], record['reason']) == ('PASS', 'label_match'), record
    assert record['score_method'] == 'reference_sift_inlier_ratio_v1'
    assert record['storage_status'] == 'saved'
    assert client.get(record['images']['annotated']).status_code == 200


def test_wrong_design_and_clipped_label_are_not_auto_capture_candidates(client):
    enroll(client)
    for frame in (scene(label_pattern(91)), scene(label_pattern())[:, 280:]):
        response = client.post('/api/locate-label', data={'expected_product': 'bottle_a'},
                               files={'image': ('frame.png', png(frame), 'image/png')})
        assert response.status_code == 200, response.text
        assert not response.json()['usable_view'], response.json()
