import cookies from '@utils/cookies'
import {track} from '@utils/analytics'
import getAccessTokenFromCookie from '@utils/getAccessTokenFromCookie'
import axios from 'axios'
import {isEmpty, pickBy, identity, get} from 'lodash'

const getOptions = () =>
  getAccessTokenFromCookie()
    ? {
        headers: {
          Authorization: `Bearer ${getAccessTokenFromCookie()}`,
        },
      }
    : {}

const toLessonViewParams = ({collection, lesson}) => {
  if (isEmpty(lesson)) {
    console.error('Cannot track lesson view for undefined lesson.')
    return
  }

  return {
    lesson_view: pickBy(
      {
        collection_type: get(collection, 'type'),
        collection_id: get(collection, 'id'),
        lesson_id: lesson.id,
      },
      identity,
    ),
  }
}

let lessonProgress

const createLessonView = (lesson, collection?) => {
  return axios
    .post(
      lesson.lesson_view_url,
      toLessonViewParams({lesson, collection}),
      getOptions(),
    )
    .then(({data}) => {
      const lessonView = data
      return lessonView
    })
}

const incrementViewSegments = (lessonView) => {
  return axios
    .put(lessonView.increment_url, {}, getOptions())
    .then(({data}) => data)
}

const storeProgress = (playedSeconds, lesson, list?) => {
  return new Promise((resolve) => {
    const isSegment = Math.round(playedSeconds) % 30 === 0
    if (isSegment) {
      createLessonView(lesson, list).then(incrementViewSegments).then(resolve)
    }
  })
}

const onProgress = (lesson) => (progress) => {
  const {playedSeconds} = progress
  const roundedProgress = Math.ceil(playedSeconds)
  const isSegment = roundedProgress % 30 === 0

  if (!isSegment) {
    return
  }

  if (!lessonProgress) {
    lessonProgress = {}
  }

  const canTrack =
    isSegment && roundedProgress > (lessonProgress[lesson.slug] || 0)

  if (!canTrack) {
    return
  }

  lessonProgress[lesson.slug] = roundedProgress

  if (lesson.lesson_view_url) {
    if (roundedProgress === 30) {
      track('started lesson', {
        lesson: lesson.slug,
        tags: lesson.tags.map((tag) => tag.slug),
      })
    }

    storeProgress(roundedProgress, lesson)
  } else {
    const segments = lessonProgress[lesson.slug] / 30
    let lessonViews = cookies.get('egghead-lessonViews') || {}
    lessonViews[lesson.id] = segments

    cookies.set('egghead-lessonViews', lessonViews)
  }
}

let emailCaptureCookie: any = {
  watchCount: 0,
}

const setEmailCaptureCookie = (captureCookie = {}) => {
  cookies.set('egghead-email', captureCookie)
  emailCaptureCookie = cookies.get('egghead-email')
}

const getOrCreateLessonView = (lesson, collection?) => {
  return axios
    .post(
      lesson.lesson_view_url,
      toLessonViewParams({lesson, collection}),
      getOptions(),
    )
    .then(({data}) => data)
}

const trackPercentComplete = (lessonView) => {
  const series = lessonView.series
  var percents = [0.1, 0.25, 0.5, 0.75]
  if (series && series.progress && series.published_lesson_count) {
    percents.forEach((percent) => {
      var trackPercent =
          Math.ceil(series.published_lesson_count * percent) ===
          series.progress.completed_lesson_count,
        percentCompleted = Math.floor(percent * 100)
      if (trackPercent) {
        track('progress in course', {
          course: series.slug,
          percent_completed: percentCompleted,
        })
      }
    })
  }
  return lessonView
}

const trackStartingCourse = (lessonView) => {
  const series = lessonView.series
  const progress = series && lessonView.series.progress

  if (progress && progress.completed_lesson_count === 0) {
    track('started course', {
      first_lesson: lessonView.lesson_slug,
      lesson_count: series.published_lesson_count,
      course: lessonView.series.slug,
    })
  }
  return lessonView
}

const completeLesson = (lessonView) =>
  axios.put(lessonView.complete_url, {}, getOptions()).then(({data}) => {
    const lessonView = data
    const series = lessonView.series
    const courseProgress = series && lessonView.series.progress

    if (courseProgress && courseProgress.is_completed) {
      track('finished course', {
        final_lesson: lessonView.lesson_slug,
        course: lessonView.series.slug,
        enhanced_transcripts_complete:
          series.lesson_count - series.enhanced_transcript_count === 0,
        lesson_count: series.published_lesson_count,
      })
    }

    return lessonView
  })

const onComplete = (lesson, collection?) => {
  return getOrCreateLessonView(lesson, collection)
    .then(trackStartingCourse)
    .then(completeLesson)
    .then(trackPercentComplete)
}

const onEnded = (lesson) => async () => {
  setEmailCaptureCookie({
    ...emailCaptureCookie,
    watchCount: emailCaptureCookie.watchCount + 1,
  })

  if (lesson.lesson_view_url) {
    onComplete(lesson)
  }

  track('finished lesson', {
    lesson: lesson.slug,
    tags: lesson.tags.map((tag) => tag.slug),
  })
}

function onError() {}

function onVideoQualityChanged() {}

function onSubtitleChange() {}

export default function useEggheadPlayer(lesson) {
  return {
    onProgress: onProgress(lesson),
    onEnded: onEnded(lesson),
    onError,
    onVideoQualityChanged,
    onSubtitleChange,
  }
}
