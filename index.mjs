'use strict';

import querystring from 'querystring';
import AWS from 'aws-sdk';
import Sharp from 'sharp';

const S3 = new AWS.S3({
  signatureVersion: 'v4',
  region: 'ap-northeast-2'  // 버킷을 생성한 리전 입력
});

// 버킷 이름
const BUCKET = 'dalkom-image' 

// 이미지 타입
const supportImageTypes = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'tiff'];

export const handler = async(event, context, callback) => {
  const { request, response } = event.Records[0].cf;
  
  // URL 헤더 파라미터 width, height, format, quality
  const { uri } = request;
  const ObjectKey = decodeURIComponent(uri).substring(1);
  const params = querystring.parse(request.querystring);
  const { w, h, q, f } = params
  
  // 크기 조절이 없는 경우 원본 반환.
  if (!(w || h)) {
    return callback(null, response);
  }

  const extension = uri.match(/\/?(.*)\.(.*)/)[2].toLowerCase();
  const width = parseInt(w, 10) || null;
  const height = parseInt(h, 10) || null;
  const quality = parseInt(q, 10) || 100;
  let format = (f || extension).toLowerCase();
  let s3Object;
  let resizedImage;

  // 포맷 변환이 없는 GIF 포맷 요청은 원본 반환.
  if (extension === 'gif' && !f) {
    return callback(null, response);
  }

  // 기본 포맷 설정
  format = format === 'jpg' ? 'jpeg' : format;

  if (!supportImageTypes.some(type => type === extension )) {
    responseHandler(
      403,
      'Forbidden',
      'Unsupported image type', [{
        key: 'Content-Type',
        value: 'text/plain'
      }],
    );

    return callback(null, response);
  }

  console.log(`parmas: ${JSON.stringify(params)}`);
  console.log('S3 Object key:', ObjectKey)

  try {
    s3Object = await S3.getObject({
      Bucket: BUCKET,
      Key: ObjectKey
    }).promise();

    console.log('S3 Object:', s3Object);
  }
  catch (error) {
    responseHandler(
      404,
      'Not Found',
      'The image does not exist.', [{ key: 'Content-Type', value: 'text/plain' }],
    );
    return callback(null, response);
  }

  try {
    resizedImage = await Sharp(s3Object.Body)
      .resize(width, height)
      .withMetadata()
      .toFormat(format, {
        quality
      })
      .toBuffer();
  }
  catch (error) {
    responseHandler(
      500,
      'Internal Server Error',
      'Fail to resize image.', [{
        key: 'Content-Type',
        value: 'text/plain'
      }],
    );
    return callback(null, response);
  }
  
  // 응답 이미지 용량이 1MB 이상일 경우 원본 반환
  if (Buffer.byteLength(resizedImage, 'base64') >= 1048576) {
    return callback(null, response);
  }

  responseHandler(
    200,
    'OK',
    resizedImage.toString('base64'), [{
      key: 'Content-Type',
      value: `image/${format}`
    }],
    'base64'
  );

  function responseHandler(status, statusDescription, body, contentHeader, bodyEncoding) {
    response.status = status;
    response.statusDescription = statusDescription;
    response.body = body;
    response.headers['content-type'] = contentHeader;
    if (bodyEncoding) {
      response.bodyEncoding = bodyEncoding;
    }
  }
  
  console.log('Success resizing image');

  return callback(null, response);
};